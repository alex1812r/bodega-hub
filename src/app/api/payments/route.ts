import { z } from "zod";

import { ApiError, toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonCreated, jsonData } from "@/lib/api/jsonResponse";
import {
  requireStoreAnyPermission,
  requireStorePermission,
} from "@/lib/api/requirePermission";
import * as paymentsMockServer from "@/modules/payments/services/payments.mock-server";
import * as paymentsServer from "@/modules/payments/services/payments.server";
import {
  assertCanCreatePurchasePayment,
  assertCanQueryPurchasePayments,
  canViewPurchasePayments,
} from "@/shared/auth/paymentAccess";
import type { Permission } from "@/shared/auth/permissions";

const paymentMethodSchema = z.enum([
  "efectivo_ves",
  "efectivo_usd",
  "pago_movil",
  "punto_venta",
  "transferencia",
]);

/** Desglose de billetes por moneda: `{"USD":{"1":3}}`. */
const denominationsSchema = z.object({
  USD: z.record(z.string(), z.number().int().nonnegative()).optional(),
  VES: z.record(z.string(), z.number().int().nonnegative()).optional(),
});

/**
 * Vuelto: es una salida, no un cobro, asi que banco/telefono/referencia son
 * opcionales incluso en metodos bancarios (spec cobro-pos-billetes §4).
 */
const changeSchema = z.object({
  amount: z.number().nonnegative(),
  bankName: z.string().optional(),
  method: paymentMethodSchema.optional(),
  phone: z.string().optional(),
  referenceCode: z.string().optional(),
});

const createPaymentSchema = z
  .object({
    amount: z.number().positive(),
    bankName: z.string().optional(),
    change: changeSchema.optional(),
    changeDenominations: denominationsSchema.nullish(),
    currency: z.enum(["USD", "VES"]).optional(),
    method: paymentMethodSchema,
    notes: z.string().optional(),
    phone: z.string().optional(),
    purchaseId: z.string().optional(),
    receivedDenominations: denominationsSchema.nullish(),
    referenceCode: z.string().optional(),
    saleId: z.string().optional(),
  })
  .refine((value) => Boolean(value.saleId) !== Boolean(value.purchaseId), {
    message: "El pago debe estar asociado a una venta o una compra.",
  })
  .superRefine((value, context) => {
    if (value.method === "pago_movil") {
      if (!value.bankName) {
        context.addIssue({
          code: "custom",
          message: "El pago movil requiere banco.",
          path: ["bankName"],
        });
      }

      if (!value.phone) {
        context.addIssue({
          code: "custom",
          message: "El pago movil requiere telefono.",
          path: ["phone"],
        });
      }

      if (!value.referenceCode || !/^\d{4}$/.test(value.referenceCode)) {
        context.addIssue({
          code: "custom",
          message: "El pago movil requiere referencia de 4 digitos.",
          path: ["referenceCode"],
        });
      }
    }

    if (value.method === "transferencia") {
      if (!value.bankName) {
        context.addIssue({
          code: "custom",
          message: "La transferencia requiere banco.",
          path: ["bankName"],
        });
      }

      if (!value.referenceCode) {
        context.addIssue({
          code: "custom",
          message: "La transferencia requiere referencia.",
          path: ["referenceCode"],
        });
      }
    }

    if (value.method === "efectivo_usd" && value.currency && value.currency !== "USD") {
      context.addIssue({
        code: "custom",
        message: "El efectivo USD debe registrarse con moneda USD.",
        path: ["currency"],
      });
    }

    if (value.change && value.change.amount > 0) {
      if (!value.change.method) {
        context.addIssue({
          code: "custom",
          message: "El vuelto requiere un metodo.",
          path: ["change", "method"],
        });
      }

      if (value.purchaseId) {
        context.addIssue({
          code: "custom",
          message: "El vuelto solo aplica a pagos de venta.",
          path: ["change"],
        });
      }
    }
  });

function getPaymentsService() {
  return resolveDataSource() === "supabase" ? paymentsServer : paymentsMockServer;
}

export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "payments.view");
    const searchParams = new URL(request.url).searchParams;
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
    const input = createPaymentSchema.parse(await request.json());
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
    return jsonCreated(await service.createPayment(input, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
