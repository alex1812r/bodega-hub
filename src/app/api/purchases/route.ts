import { z } from "zod";

import { ApiError, toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonCreated, jsonData } from "@/lib/api/jsonResponse";
import { readJsonBody } from "@/lib/api/readJsonBody";
import { requireStorePermission } from "@/lib/api/requirePermission";
import * as invoiceScanMockServer from "@/modules/invoice-scan/server/confirmScan.mock-server";
import * as invoiceScanServer from "@/modules/invoice-scan/server/confirmScan.server";
import { normalizeExtractionForMatch } from "@/modules/invoice-scan/server/matchScan";
import * as paymentsMockServer from "@/modules/payments/services/payments.mock-server";
import * as paymentsServer from "@/modules/payments/services/payments.server";
import {
  createPurchaseSchema,
  type initialPaymentSchema,
} from "@/modules/purchases/schemas/createPurchase.schema";
import * as purchasesMockServer from "@/modules/purchases/services/purchases.mock-server";
import * as purchasesServer from "@/modules/purchases/services/purchases.server";
import { canViewPurchasePayments } from "@/shared/auth/paymentAccess";

const LIST_FILTER_KEYS = ["from", "to", "pendingBalance"] as const;

/** Fecha de calendario Caracas `YYYY-MM-DD` que además exista (no `2026-02-31`). */
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe tener el formato YYYY-MM-DD.")
  .refine((value) => {
    const date = new Date(`${value}T12:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "La fecha no es válida.");

const listPurchasesQuerySchema = z
  .object({
    from: isoDateSchema.optional(),
    pendingBalance: z
      .literal("1", { message: "El filtro de saldo pendiente solo admite el valor 1." })
      .optional(),
    to: isoDateSchema.optional(),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: "La fecha inicial no puede ser posterior a la final.",
    path: ["from"],
  });

/**
 * Valida `from`, `to` y `pendingBalance` y los deja normalizados en la query que
 * reciben los servicios: un parámetro vacío o en blanco equivale a no enviarlo.
 */
function withValidatedListFilters(searchParams: URLSearchParams) {
  const filters = listPurchasesQuerySchema.parse(
    Object.fromEntries(
      LIST_FILTER_KEYS.flatMap((key) => {
        const value = searchParams.get(key)?.trim();
        return value ? [[key, value]] : [];
      }),
    ),
  );
  const normalized = new URLSearchParams(searchParams);

  for (const key of LIST_FILTER_KEYS) {
    const value = filters[key];

    if (value) {
      normalized.set(key, value);
    } else {
      normalized.delete(key);
    }
  }

  return normalized;
}

function getPurchasesService() {
  return resolveDataSource() === "supabase" ? purchasesServer : purchasesMockServer;
}

function getInvoiceScanService() {
  return resolveDataSource() === "supabase" ? invoiceScanServer : invoiceScanMockServer;
}

function getPaymentsService() {
  return resolveDataSource() === "supabase" ? paymentsServer : paymentsMockServer;
}

export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "purchases.view");
    const searchParams = withValidatedListFilters(new URL(request.url).searchParams);
    const service = getPurchasesService();
    return jsonData(await service.listPurchases(searchParams, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}

const UNCONFIRMED_INITIAL_PAYMENT_MESSAGE =
  "No pudimos confirmar si el pago se registró. Revisa los pagos de la compra antes de registrarlo de nuevo.";

/** Resultado del pago inicial que viaja con la compra creada. */
type PurchaseInitialPaymentResult =
  | { paymentId: string; status: "registered" }
  | { message: string; status: "failed" };

/**
 * Registra el pago inicial de una compra YA creada. Nunca lanza: la compra existe,
 * así que un pago rechazado (PT4xx de `register_payment`) o de resultado incierto
 * (red, 5xx) se devuelve como `failed` con su motivo y la compra queda pendiente.
 */
async function registerInitialPayment(
  payment: z.infer<typeof initialPaymentSchema>,
  purchaseId: string,
  storeId: string,
): Promise<PurchaseInitialPaymentResult> {
  try {
    const registered = await getPaymentsService().createPayment(
      { ...payment, purchaseId },
      storeId,
    );

    return { paymentId: registered.id, status: "registered" };
  } catch (error) {
    return {
      message:
        error instanceof ApiError && error.status < 500
          ? error.message
          : UNCONFIRMED_INITIAL_PAYMENT_MESSAGE,
      status: "failed",
    };
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireStorePermission(request, "purchases.create");
    // Compra y pago se validan juntos: con un pago inválido no se crea nada.
    const { initialPayment, invoiceScanExtraction, invoiceScanId, invoiceScanLines, ...input } =
      createPurchaseSchema.parse(await readJsonBody(request));

    if (initialPayment) {
      // Mismos permisos que `POST /api/payments` exige para un pago de compra,
      // comprobados antes de crear la compra.
      if (!canViewPurchasePayments(auth.role) || !auth.permissions.includes("payments.manage")) {
        throw new ApiError(403, "FORBIDDEN", "No tienes permiso para registrar pagos de compras.");
      }
    }

    // SCN-06 · caos 6.14: escaneo ajeno, inexistente, ya confirmado o reclamado por
    // otro intento → 400 sin crear la compra (salvo el replay del mismo intento).
    // El esquema exige clientRequestId junto a invoiceScanId (SCN-06-F1).
    const scanService = getInvoiceScanService();
    const scanClaim =
      invoiceScanId && input.clientRequestId
        ? { clientRequestId: input.clientRequestId, scanId: invoiceScanId }
        : null;
    const scan = scanClaim
      ? await scanService.precheckInvoiceScan({ ...scanClaim, lines: invoiceScanLines }, auth.storeId)
      : null;

    const service = getPurchasesService();
    let purchase: Awaited<ReturnType<typeof service.createPurchase>>;

    try {
      purchase = await service.createPurchase(input, auth.storeId);
    } catch (error) {
      // Rechazo definitivo (4xx): la compra no existe y se suelta el reclamo para
      // reintentar con otra clave. Resultado incierto (5xx, red): el reclamo se
      // queda; el mismo intento lo recupera y, si no vuelve, caduca.
      if (scanClaim && error instanceof ApiError && error.status < 500) {
        await scanService.releaseInvoiceScanClaim(scanClaim, auth.storeId);
      }

      throw error;
    }

    // No lanza salvo una excepción: la compra ya existe y el resultado viaja en
    // `invoiceScan`. Si la compra devuelta es de OTRO intento (clave reutilizada con
    // otro escaneo; SCN-06-F2 · M1) lanza 400 sin confirmar el escaneo.
    const invoiceScan = scan
      ? await scanService.finalizeInvoiceScan(
          scan,
          {
            clientRequestId: input.clientRequestId,
            // SCN-13a-F1: la lectura corregida del cliente pasa por el mismo borde que la del modelo.
            extraction: invoiceScanExtraction && normalizeExtractionForMatch(invoiceScanExtraction),
            items: input.items,
            lines: invoiceScanLines ?? [],
            purchaseId: purchase.id,
            supplierId: purchase.supplierId ?? input.supplierId,
          },
          auth.storeId,
        )
      : null;
    const created = invoiceScan ? { ...purchase, invoiceScan } : purchase;

    if (!initialPayment) {
      return jsonCreated(created);
    }

    // En secuencia y con dos claves: reintentar el mismo intento devuelve la misma
    // compra y el mismo pago. El pago inicial es un `register_payment` normal.
    return jsonCreated({
      ...created,
      initialPayment: await registerInitialPayment(initialPayment, purchase.id, auth.storeId),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
