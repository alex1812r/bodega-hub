import { VENEZUELAN_BANKS, formatBankLabel } from "@/shared/venezuela/banks";

import {
  PAYMENT_AMOUNT_MAX,
  PAYMENT_TEXT_LIMITS,
  changeSchema,
  salePaymentLineSchema,
} from "./paymentSchemas";

const TEXT_FIELDS = ["notes", "referenceCode", "bankName", "phone"] as const;

const transfer = {
  amount: 10,
  bankName: "Banco Nacional",
  method: "transferencia" as const,
  referenceCode: "TRX-1",
};

function issuesOf(input: unknown) {
  const result = salePaymentLineSchema.safeParse(input);

  return result.success ? [] : result.error.issues.map((issue) => ({
    message: issue.message,
    path: issue.path,
  }));
}

describe("paymentSchemas: texto libre de un cobro (PAG-F5)", () => {
  it.each(TEXT_FIELDS)("rechaza el caracter NUL en %s con un mensaje en espanol", (field) => {
    expect(issuesOf({ ...transfer, [field]: "\u0000nulo" })).toEqual([
      { message: "El texto contiene caracteres no permitidos.", path: [field] },
    ]);
  });

  it.each(["\u0001", "\u0008", "\u000B", "\u001F", "\u007F"])(
    "rechaza el caracter de control %j",
    (character) => {
      expect(issuesOf({ ...transfer, notes: `nota${character}` })).toHaveLength(1);
    },
  );

  it("rechaza el caracter NUL tambien en los datos del vuelto, que terminan en las notas", () => {
    for (const field of ["bankName", "phone", "referenceCode"] as const) {
      expect(changeSchema.safeParse({ amount: 1, [field]: "\u0000" }).success).toBe(false);
    }
  });

  it("sigue aceptando lo que el POS y el formulario de abono envian hoy", () => {
    const accepted = [
      { amount: 10, method: "efectivo_ves" },
      { amount: 10, method: "punto_venta", referenceCode: "000123" },
      { ...transfer, notes: "Linea 1\nLinea 2\r\n\tcon tabulador, acentos áéíóú ñ y emoji 🧾" },
      { ...transfer, notes: "'; drop table payments; -- <script>alert(1)</script> {{7*7}}" },
      {
        amount: 10,
        bankName: "0102 - Banco de Venezuela",
        method: "pago_movil",
        phone: "0412 555-1234",
        referenceCode: "1234",
      },
      // El servidor no exige formato de telefono: solo longitud y caracteres.
      { amount: 10, bankName: "Banesco", method: "pago_movil", phone: "+58 412-5551234", referenceCode: "1234" },
      {
        amount: 3,
        change: { amount: 560, bankName: "Banesco", method: "pago_movil", phone: "04125551234", referenceCode: "9876" },
        currency: "USD",
        method: "efectivo_usd",
      },
    ];

    for (const input of accepted) {
      expect(issuesOf(input)).toEqual([]);
    }
  });

  it("acepta todas las etiquetas de banco de la lista de la UI", () => {
    for (const bank of VENEZUELAN_BANKS) {
      expect(
        issuesOf({ ...transfer, bankName: formatBankLabel(bank.code, bank.name) }),
      ).toEqual([]);
    }
  });

  it.each(TEXT_FIELDS)("acepta %s hasta su limite y lo rechaza un caracter despues", (field) => {
    const limit = PAYMENT_TEXT_LIMITS[field];

    expect(issuesOf({ ...transfer, [field]: "7".repeat(limit) })).toEqual([]);
    expect(issuesOf({ ...transfer, [field]: "7".repeat(limit + 1) })).toEqual([
      { message: `El texto no puede superar ${limit} caracteres.`, path: [field] },
    ]);
  });

  it("los limites no cambian sin que se entere el contrato", () => {
    expect(PAYMENT_TEXT_LIMITS).toEqual({
      bankName: 120,
      notes: 2000,
      phone: 30,
      referenceCode: 100,
    });
  });
});

describe("paymentSchemas: tope del monto (PAG-F8)", () => {
  const TOO_BIG = "El monto no puede superar 1.000.000.000.000.";

  it("acepta el tope y rechaza un monto mayor con un mensaje en espanol", () => {
    expect(PAYMENT_AMOUNT_MAX).toBe(1_000_000_000_000);
    expect(issuesOf({ amount: PAYMENT_AMOUNT_MAX, method: "efectivo_ves" })).toEqual([]);

    for (const amount of [PAYMENT_AMOUNT_MAX + 1, 1e308]) {
      expect(issuesOf({ amount, method: "efectivo_ves" })).toEqual([
        { message: TOO_BIG, path: ["amount"] },
      ]);
    }
  });

  it("el vuelto tiene el mismo tope", () => {
    expect(
      changeSchema.safeParse({ amount: PAYMENT_AMOUNT_MAX, method: "efectivo_ves" }).success,
    ).toBe(true);
    expect(
      issuesOf({
        amount: 10,
        change: { amount: 1e308, method: "efectivo_ves" },
        method: "efectivo_ves",
      }),
    ).toEqual([{ message: TOO_BIG, path: ["change", "amount"] }]);
  });
});
