import { z } from "zod";

import { ApiError, toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonCreated, jsonData } from "@/lib/api/jsonResponse";
import { readJsonBody } from "@/lib/api/readJsonBody";
import { requireStorePermission } from "@/lib/api/requirePermission";
import {
  addPaymentLineIssues,
  paymentLineFields,
} from "@/modules/payments/services/paymentSchemas";
import * as paymentsMockServer from "@/modules/payments/services/payments.mock-server";
import * as paymentsServer from "@/modules/payments/services/payments.server";
import { purchaseItemInputSchema } from "@/modules/purchases/schemas/purchaseItem.schema";
import * as purchasesMockServer from "@/modules/purchases/services/purchases.mock-server";
import * as purchasesServer from "@/modules/purchases/services/purchases.server";
import { canViewPurchasePayments } from "@/shared/auth/paymentAccess";

/**
 * Pago inicial opcional de la compra: el cuerpo de `POST /api/payments` sin el
 * documento (`purchaseId` lo pone el servidor con la compra recién creada), con las
 * mismas reglas por método. Lleva su propia clave de idempotencia, obligatoria: la
 * compra puede reintentarse y el pago no debe entrar dos veces.
 */
const initialPaymentSchema = z
  .object({
    ...paymentLineFields,
    clientRequestId: z.string().uuid(),
  })
  .superRefine((value, context) => {
    addPaymentLineIssues(value, context);

    if (value.change && value.change.amount > 0) {
      context.addIssue({
        code: "custom",
        message: "El vuelto solo aplica a pagos de venta.",
        path: ["change"],
      });
    }
  });

const createPurchaseSchema = z.object({
  // Clave de idempotencia por intento (C6): con la misma clave en la misma tienda
  // el servidor devuelve el resultado original en vez de repetir el movimiento.
  // Opcional para no romper clientes que aun no la envian.
  clientRequestId: z.string().uuid().optional(),
  discountRef: z.number().min(0),
  discountVes: z.number().min(0),
  exchangeRateId: z.string().uuid().optional(),
  initialPayment: initialPaymentSchema.optional(),
  items: z.array(purchaseItemInputSchema).min(1),
  notes: z.string().optional(),
  purchaseNumber: z.string().optional(),
  refRateVes: z.number().positive(),
  status: z.enum(["pedido", "recibido"]).default("recibido"),
  subtotalRef: z.number().min(0),
  subtotalVes: z.number().min(0),
  supplierId: z.string().min(1),
  taxRef: z.number().min(0),
  taxVes: z.number().min(0),
});

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
    const { initialPayment, ...input } = createPurchaseSchema.parse(await readJsonBody(request));

    if (initialPayment) {
      // Mismos permisos que `POST /api/payments` exige para un pago de compra,
      // comprobados antes de crear la compra.
      if (!canViewPurchasePayments(auth.role) || !auth.permissions.includes("payments.manage")) {
        throw new ApiError(403, "FORBIDDEN", "No tienes permiso para registrar pagos de compras.");
      }
    }

    const service = getPurchasesService();
    const purchase = await service.createPurchase(input, auth.storeId);

    if (!initialPayment) {
      return jsonCreated(purchase);
    }

    // En secuencia y con dos claves: reintentar el mismo intento devuelve la misma
    // compra y el mismo pago. El pago inicial es un `register_payment` normal.
    return jsonCreated({
      ...purchase,
      initialPayment: await registerInitialPayment(initialPayment, purchase.id, auth.storeId),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
