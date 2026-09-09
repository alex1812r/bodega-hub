import { z } from "zod";

/**
 * Esquemas compartidos entre `POST /api/payments` (cobro suelto) y
 * `POST /api/sales` (cobros que viajan con la venta y se registran en la misma
 * transaccion). Las reglas por metodo viven aqui para que ambos caminos exijan
 * exactamente lo mismo; `register_payment` las vuelve a validar en la base.
 */

export const paymentMethodSchema = z.enum([
  "efectivo_ves",
  "efectivo_usd",
  "pago_movil",
  "punto_venta",
  "transferencia",
]);

/** Desglose de billetes por moneda: `{"USD":{"1":3}}`. */
export const denominationsSchema = z.object({
  USD: z.record(z.string(), z.number().int().nonnegative()).optional(),
  VES: z.record(z.string(), z.number().int().nonnegative()).optional(),
});

/**
 * Vuelto: es una salida, no un cobro, asi que banco/telefono/referencia son
 * opcionales incluso en metodos bancarios (spec cobro-pos-billetes §4).
 */
export const changeSchema = z.object({
  amount: z.number().nonnegative(),
  bankName: z.string().optional(),
  method: paymentMethodSchema.optional(),
  phone: z.string().optional(),
  referenceCode: z.string().optional(),
});

/** Campos de una linea de cobro, sin el documento al que pertenece. */
export const paymentLineFields = {
  amount: z.number().positive(),
  bankName: z.string().optional(),
  change: changeSchema.optional(),
  changeDenominations: denominationsSchema.nullish(),
  currency: z.enum(["USD", "VES"]).optional(),
  method: paymentMethodSchema,
  notes: z.string().optional(),
  phone: z.string().optional(),
  receivedDenominations: denominationsSchema.nullish(),
  referenceCode: z.string().optional(),
};

type PaymentLine = z.infer<z.ZodObject<typeof paymentLineFields>>;

/** Reglas por metodo y de vuelto que comparten el cobro suelto y el cobro con venta. */
export function addPaymentLineIssues(
  value: PaymentLine,
  context: z.RefinementCtx,
  path: Array<number | string> = [],
) {
  const at = (...segments: string[]) => [...path, ...segments];

  if (value.method === "pago_movil") {
    if (!value.bankName) {
      context.addIssue({
        code: "custom",
        message: "El pago movil requiere banco.",
        path: at("bankName"),
      });
    }

    if (!value.phone) {
      context.addIssue({
        code: "custom",
        message: "El pago movil requiere telefono.",
        path: at("phone"),
      });
    }

    if (!value.referenceCode || !/^\d{4}$/.test(value.referenceCode)) {
      context.addIssue({
        code: "custom",
        message: "El pago movil requiere referencia de 4 digitos.",
        path: at("referenceCode"),
      });
    }
  }

  if (value.method === "transferencia") {
    if (!value.bankName) {
      context.addIssue({
        code: "custom",
        message: "La transferencia requiere banco.",
        path: at("bankName"),
      });
    }

    if (!value.referenceCode) {
      context.addIssue({
        code: "custom",
        message: "La transferencia requiere referencia.",
        path: at("referenceCode"),
      });
    }
  }

  if (value.method === "efectivo_usd" && value.currency && value.currency !== "USD") {
    context.addIssue({
      code: "custom",
      message: "El efectivo USD debe registrarse con moneda USD.",
      path: at("currency"),
    });
  }

  if (value.change && value.change.amount > 0 && !value.change.method) {
    context.addIssue({
      code: "custom",
      message: "El vuelto requiere un metodo.",
      path: at("change", "method"),
    });
  }
}

/** Linea de cobro que viaja dentro de `POST /api/sales`. */
export const salePaymentLineSchema = z
  .object(paymentLineFields)
  .superRefine((value, context) => addPaymentLineIssues(value, context));

export type SalePaymentLineInput = z.infer<typeof salePaymentLineSchema>;
