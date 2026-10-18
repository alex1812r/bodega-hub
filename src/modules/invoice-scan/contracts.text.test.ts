/**
 * @jest-environment node
 */
/**
 * CIE-06 (auditoría pasada 1 · M1) · los textos de `invoiceExtractionSchema` no
 * admiten U+0000, caracteres de control (salvo tabulador y saltos de línea),
 * surrogates sueltos ni longitudes desmesuradas: Postgres rechaza el U+0000 en
 * `jsonb` (22P05) y el fallo llegaba DESPUÉS de crear la compra.
 */
import { z } from "zod";

import {
  INVOICE_TEXT_MAX_LENGTH,
  INVOICE_WARNINGS_MAX,
  invoiceExtractionSchema,
  type InvoiceExtraction,
} from "./contracts";

const valid: InvoiceExtraction = {
  confidence: 0.9,
  currency: "VES",
  lines: [
    {
      barcode: "7591234567890",
      confidence: 0.9,
      description: "Harina PAN 1kg",
      lineTotal: 10,
      quantity: 1,
      rawText: "1\tHARINA PAN 1KG\n10,00",
      supplierSku: "HP-1",
      unitPrice: 10,
    },
  ],
  number: "000123",
  supplier: { address: "Caracas", name: "Distribuidora Lab", phone: "0212", taxId: "J-1" },
  warnings: ["Revisa la tasa"],
};

type Mutation = [string, (draft: InvoiceExtraction) => void];

const textFields: Array<[string, (draft: InvoiceExtraction, value: string) => void]> = [
  ["supplier.name", (draft, value) => (draft.supplier.name = value)],
  ["supplier.taxId", (draft, value) => (draft.supplier.taxId = value)],
  ["supplier.phone", (draft, value) => (draft.supplier.phone = value)],
  ["supplier.address", (draft, value) => (draft.supplier.address = value)],
  ["number", (draft, value) => (draft.number = value)],
  ["date", (draft, value) => (draft.date = value)],
  ["lines[0].rawText", (draft, value) => (draft.lines[0]!.rawText = value)],
  ["lines[0].description", (draft, value) => (draft.lines[0]!.description = value)],
  ["lines[0].barcode", (draft, value) => (draft.lines[0]!.barcode = value)],
  ["lines[0].supplierSku", (draft, value) => (draft.lines[0]!.supplierSku = value)],
  ["warnings[0]", (draft, value) => (draft.warnings[0] = value)],
];

function mutate(apply: (draft: InvoiceExtraction) => void): unknown {
  const draft = structuredClone(valid);
  apply(draft);
  return draft;
}

describe("invoiceExtractionSchema · textos seguros para jsonb (CIE-06)", () => {
  it("acepta tabulador, saltos de línea, acentos y emojis", () => {
    expect(invoiceExtractionSchema.safeParse(mutate((draft) => (draft.supplier.name = "Ñandú 😀\r\nC.A."))).success).toBe(
      true,
    );
  });

  const rejected: Mutation[] = textFields.flatMap(([field, set]): Mutation[] => [
    [`${field} con U+0000`, (draft) => set(draft, "X\u0000")],
    [`${field} con U+0001`, (draft) => set(draft, "a\u0001b")],
    [`${field} con U+007F`, (draft) => set(draft, "a\u007fb")],
    [`${field} con U+0085 (control C1)`, (draft) => set(draft, "a\u0085b")],
    [`${field} con surrogate alto suelto`, (draft) => set(draft, "a\ud83db")],
    [`${field} con surrogate bajo suelto`, (draft) => set(draft, "a\ude00")],
    [`${field} de más de ${INVOICE_TEXT_MAX_LENGTH} caracteres`, (draft) => set(draft, "x".repeat(INVOICE_TEXT_MAX_LENGTH + 1))],
  ]);

  it.each(rejected)("rechaza %s con un mensaje en español", (_caso, apply) => {
    const parsed = invoiceExtractionSchema.safeParse(mutate(apply));

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toMatch(/factura/);
  });

  it(`rechaza más de ${INVOICE_WARNINGS_MAX} avisos`, () => {
    const parsed = invoiceExtractionSchema.safeParse(
      mutate((draft) => (draft.warnings = Array.from({ length: INVOICE_WARNINGS_MAX + 1 }, () => "aviso"))),
    );

    expect(parsed.success).toBe(false);
  });

  it("acepta un texto de exactamente el máximo", () => {
    expect(
      invoiceExtractionSchema.safeParse(mutate((draft) => (draft.lines[0]!.rawText = "x".repeat(INVOICE_TEXT_MAX_LENGTH))))
        .success,
    ).toBe(true);
  });

  it("no cambia el JSON Schema que recibe el modelo (sin maxLength ni pattern)", () => {
    const json = JSON.stringify(z.toJSONSchema(invoiceExtractionSchema));

    expect(json).not.toMatch(/maxLength|pattern|maxItems/);
  });
});
