import { z } from "zod";

import { ApiError, toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonCreated, jsonData } from "@/lib/api/jsonResponse";
import { readJsonBody } from "@/lib/api/readJsonBody";
import {
  requireStoreAnyPermission,
  requireStorePermission,
} from "@/lib/api/requirePermission";
import {
  addPaymentLineIssues,
  paymentLineFields,
} from "@/modules/payments/services/paymentSchemas";
import * as paymentsMockServer from "@/modules/payments/services/payments.mock-server";
import * as paymentsServer from "@/modules/payments/services/payments.server";
import {
  assertCanCreatePurchasePayment,
  assertCanQueryPurchasePayments,
  canViewPurchasePayments,
} from "@/shared/auth/paymentAccess";
import type { Permission } from "@/shared/auth/permissions";

// Las reglas por metodo y de vuelto viven en `paymentSchemas.ts`, compartidas con
// los cobros que viajan dentro de `POST /api/sales`.
const createPaymentSchema = z
  .object({
    ...paymentLineFields,
    // Clave de idempotencia por intento (P4-3): con la misma clave en la misma
    // tienda el servidor devuelve el pago original en vez de registrar otro.
    // Opcional para no romper clientes que aun no la envian (app movil).
    clientRequestId: z.string().uuid().optional(),
    purchaseId: z.string().optional(),
    saleId: z.string().optional(),
  })
  .refine((value) => Boolean(value.saleId) !== Boolean(value.purchaseId), {
    message: "El pago debe estar asociado a una venta o una compra.",
  })
  .superRefine((value, context) => {
    addPaymentLineIssues(value, context);

    if (value.change && value.change.amount > 0 && value.purchaseId) {
      context.addIssue({
        code: "custom",
        message: "El vuelto solo aplica a pagos de venta.",
        path: ["change"],
      });
    }
  });

const PAYMENT_METHODS = [
  "efectivo_usd",
  "efectivo_ves",
  "pago_movil",
  "punto_venta",
  "transferencia",
] as const;

const LIST_FILTER_KEYS = ["method", "from", "to"] as const;

/** Fecha de calendario Caracas `YYYY-MM-DD` que ademas exista (no `2026-02-31`). */
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe tener el formato YYYY-MM-DD.")
  .refine((value) => {
    const date = new Date(`${value}T12:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "La fecha no es valida.");

const listPaymentsQuerySchema = z
  .object({
    from: isoDateSchema.optional(),
    method: z.enum(PAYMENT_METHODS).optional(),
    to: isoDateSchema.optional(),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: "La fecha inicial no puede ser posterior a la final.",
    path: ["from"],
  });

/**
 * Valida `method`, `from` y `to` y los deja normalizados en la query que reciben
 * los servicios: un parametro vacio o en blanco equivale a no enviarlo.
 */
function withValidatedListFilters(searchParams: URLSearchParams) {
  const filters = listPaymentsQuerySchema.parse(
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

function getPaymentsService() {
  return resolveDataSource() === "supabase" ? paymentsServer : paymentsMockServer;
}

export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "payments.view");
    const searchParams = withValidatedListFilters(new URL(request.url).searchParams);
    assertCanQueryPurchasePayments(auth.role, searchParams);
    const service = getPaymentsService();
    return jsonData(
      await service.listPayments(searchParams, auth.storeId, {
        salePaymentsOnly: !canViewPurchasePayments(auth.role),
      }),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    // Vendedor cobra en POS con sales.create; contador/admin con payments.manage.
    // RPC register_payment ya autoriza vendedor solo en pagos de venta.
    const auth = await requireStoreAnyPermission(request, [
      "payments.manage",
      "sales.create",
    ] satisfies Permission[]);
    const input = createPaymentSchema.parse(await readJsonBody(request));
    assertCanCreatePurchasePayment(auth.role, input);

    const canManagePayments = auth.permissions.includes("payments.manage");
    if (input.purchaseId && !canManagePayments) {
      throw new ApiError(
        403,
        "FORBIDDEN",
        "No tienes permiso para registrar pagos de compras.",
      );
    }
    if (input.saleId && !canManagePayments && !auth.permissions.includes("sales.create")) {
      throw new ApiError(403, "FORBIDDEN", "No tienes permiso para registrar pagos de ventas.");
    }

    const service = getPaymentsService();
    // Un reintento con la misma clave responde 201 con el pago original, igual
    // que POST /api/purchases: el cliente no distingue el replay del alta.
    return jsonCreated(await service.createPayment(input, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
