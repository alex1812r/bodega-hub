import { z } from "zod";

import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonCreated, jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import * as paymentsMockServer from "@/modules/payments/services/payments.mock-server";
import * as paymentsServer from "@/modules/payments/services/payments.server";

const createPaymentSchema = z
  .object({
    amount: z.number().positive(),
    bankName: z.string().optional(),
    currency: z.enum(["USD", "VES"]).optional(),
    method: z.enum([
      "efectivo_ves",
      "efectivo_usd",
      "pago_movil",
      "punto_venta",
      "transferencia",
    ]),
    notes: z.string().optional(),
    phone: z.string().optional(),
    purchaseId: z.string().optional(),
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
  });

function getPaymentsService() {
  return resolveDataSource() === "supabase" ? paymentsServer : paymentsMockServer;
}

export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "payments.view");
    const service = getPaymentsService();
    return jsonData(await service.listPayments(new URL(request.url).searchParams, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireStorePermission(request, "payments.manage");
    const input = createPaymentSchema.parse(await request.json());
    const service = getPaymentsService();
    return jsonCreated(await service.createPayment(input, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
