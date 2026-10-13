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

/**
 * Tope de cada texto libre de un cobro. Las columnas son `text` sin limite, asi que
 * el tope lo pone el servidor: holgado frente a lo que envian el POS y el formulario
 * de abono (etiqueta de banco de la lista, telefono de 11 digitos, referencia bancaria).
 */
export const PAYMENT_TEXT_LIMITS = {
  bankName: 120,
  notes: 2000,
  phone: 30,
  referenceCode: 100,
} as const;

/**
 * Tope de un monto (y de un vuelto), en la moneda que sea. `register_payment` ya
 * rechaza lo que supere el saldo; este tope corta antes los valores absurdos
 * (`1e308`), que en el mock dejaban el documento con `paidVes` infinito.
 */
export const PAYMENT_AMOUNT_MAX = 1_000_000_000_000;

const AMOUNT_TOO_BIG_MESSAGE = "El monto no puede superar 1.000.000.000.000.";

/**
 * Caracteres de control que no se imprimen (NUL incluido, que Postgres no admite en
 * `text`). Tabulador, salto de linea y retorno de carro si se aceptan.
 */
function hasControlCharacter(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127) {
      return true;
    }
  }

  return false;
}

/** Texto libre de un cobro: con tope de longitud y sin caracteres de control. */
function paymentText(field: keyof typeof PAYMENT_TEXT_LIMITS) {
  const limit = PAYMENT_TEXT_LIMITS[field];

  return z
    .string()
    .max(limit, `El texto no puede superar ${limit} caracteres.`)
    .refine((value) => !hasControlCharacter(value), "El texto contiene caracteres no permitidos.");
}

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
  amount: z.number().nonnegative().max(PAYMENT_AMOUNT_MAX, AMOUNT_TOO_BIG_MESSAGE),
  bankName: paymentText("bankName").optional(),
  method: paymentMethodSchema.optional(),
  phone: paymentText("phone").optional(),
  referenceCode: paymentText("referenceCode").optional(),
});

/** Campos de una linea de cobro, sin el documento al que pertenece. */
export const paymentLineFields = {
  amount: z.number().positive().max(PAYMENT_AMOUNT_MAX, AMOUNT_TOO_BIG_MESSAGE),
  bankName: paymentText("bankName").optional(),
  change: changeSchema.optional(),
  changeDenominations: denominationsSchema.nullish(),
  currency: z.enum(["USD", "VES"]).optional(),
  method: paymentMethodSchema,
  notes: paymentText("notes").optional(),
  phone: paymentText("phone").optional(),
  receivedDenominations: denominationsSchema.nullish(),
  referenceCode: paymentText("referenceCode").optional(),
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
        message: "El pago móvil requiere banco.",
        path: at("bankName"),
      });
    }

    if (!value.phone) {
      context.addIssue({
        code: "custom",
        message: "El pago móvil requiere teléfono.",
        path: at("phone"),
      });
    }

    if (!value.referenceCode || !/^\d{4}$/.test(value.referenceCode)) {
      context.addIssue({
        code: "custom",
        message: "El pago móvil requiere referencia de 4 dígitos.",
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
      message: "El vuelto requiere un método.",
      path: at("change", "method"),
    });
  }
}

/** Linea de cobro que viaja dentro de `POST /api/sales`. */
export const salePaymentLineSchema = z
  .object(paymentLineFields)
  .superRefine((value, context) => addPaymentLineIssues(value, context));

export type SalePaymentLineInput = z.infer<typeof salePaymentLineSchema>;
