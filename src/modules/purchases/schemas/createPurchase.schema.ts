import { z } from "zod";

import {
  addInvoiceScanBodyIssues,
  invoiceScanBodyFields,
} from "@/modules/invoice-scan/server/confirmScan.server";
import {
  addPaymentLineIssues,
  paymentLineFields,
} from "@/modules/payments/services/paymentSchemas";
import { purchaseItemInputSchema } from "@/modules/purchases/schemas/purchaseItem.schema";
import { safeText } from "@/modules/purchases/schemas/safeText";

/**
 * Pago inicial opcional de la compra: el cuerpo de `POST /api/payments` sin el
 * documento (`purchaseId` lo pone el servidor con la compra recién creada), con las
 * mismas reglas por método. Lleva su propia clave de idempotencia, obligatoria: la
 * compra puede reintentarse y el pago no debe entrar dos veces.
 */
export const initialPaymentSchema = z
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

/** Body de `POST /api/purchases`. */
export const createPurchaseSchema = z
  .object({
    // Clave de idempotencia por intento (C6): con la misma clave en la misma tienda
    // el servidor devuelve el resultado original en vez de repetir el movimiento.
    // Opcional para no romper clientes que aun no la envian.
    clientRequestId: z.string().uuid().optional(),
    discountRef: z.number().min(0),
    discountVes: z.number().min(0),
    exchangeRateId: z.string().uuid().optional(),
    initialPayment: initialPaymentSchema.optional(),
    // SCN-06: escaneo de factura del que sale la compra (opcional). Ver
    // `confirmScan.server.ts`: se valida antes de crear y se confirma y aprende después.
    ...invoiceScanBodyFields,
    items: z.array(purchaseItemInputSchema).min(1),
    notes: safeText().optional(),
    purchaseNumber: safeText().optional(),
    refRateVes: z.number().positive(),
    status: z.enum(["pedido", "recibido"]).default("recibido"),
    subtotalRef: z.number().min(0),
    subtotalVes: z.number().min(0),
    supplierId: safeText().min(1),
    taxRef: z.number().min(0),
    taxVes: z.number().min(0),
  })
  .superRefine((value, context) => addInvoiceScanBodyIssues(value, context));
