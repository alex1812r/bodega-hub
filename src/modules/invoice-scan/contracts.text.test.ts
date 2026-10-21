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
  correctedInvoiceExtractionSchema,
  INVOICE_CORRECTED_TOO_LARGE_MESSAGE,
  INVOICE_IMPOSSIBLE_DATE_MESSAGE,
  INVOICE_MAX_LINES,
  INVOICE_TEXT_INVALID_MESSAGE,
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

describe("correctedInvoiceExtractionSchema · extracción corregida (REP-05)", () => {
  const invisibles = [
    "\u202a", "\u202e", "\u2066", "\u2069", "\u200e", "\u200f", "\u061c", "\u200b", "\u200c", "\u200d", "\u2060", "\ufeff",
    // REP2-03b (caos N2): guion blando, separadores de l\u00ednea/p\u00e1rrafo, rellenos y tags.
    "\u00ad", "\u2028", "\u2029", "\u3164", "\u180e", "\u034f", "\udb40\udc00", "\udb40\udc41", "\udb40\udc7f",
    // REP3-03b (caos N8 / auditor\u00eda B16): anotaciones, rellenos hangul, Khmer, operadores invisibles,
    // formatos obsoletos, selectores de variante sueltos, notaci\u00f3n musical y braille vac\u00edo.
    "\ufff9", "\ufffa", "\ufffb", "\u115f", "\u1160", "\uffa0", "\u17b4", "\u17b5",
    "\u2061", "\u2062", "\u2063", "\u2064", "\u206a", "\u206f", "\ufe00", "\ufe0d", "\ufe0e", "\ufe0f",
    "\udb40\udd00", "\udb40\uddef", "\ud834\udd73", "\ud834\udd7a", "\u2800",
  ];

  it.each(textFields.flatMap(([field, set]) => invisibles.map((char): [string, string, typeof set] => [field, char, set])))(
    "rechaza en %s el carácter %s (bidi o ancho cero, caos B5)",
    (_field, escaped, set) => {
      const char = JSON.parse(`"${escaped}"`) as string;
      const parsed = correctedInvoiceExtractionSchema.safeParse(mutate((draft) => set(draft, `AVILA${char}X`)));

      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]?.message).toBe(INVOICE_TEXT_INVALID_MESSAGE);
    },
  );

  it("acepta emoji, también los unidos con U+200D", () => {
    const family = JSON.parse('"\ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d\udc67"') as string;
    const heart = JSON.parse('"\u2764\ufe0f\u200d\ud83d\udd25"') as string;

    expect(
      correctedInvoiceExtractionSchema.safeParse(mutate((draft) => (draft.supplier.name = `AVILA 😀 ${family} ${heart}`))).success,
    ).toBe(true);
  });

  it("acepta emoji con selector de variante y keycaps (U+FE0F solo se veta suelto)", () => {
    const name = "AVILA \u2764\ufe0f \u00a9\ufe0f 1\ufe0f\u20e3";

    expect(correctedInvoiceExtractionSchema.safeParse(mutate((draft) => (draft.supplier.name = name))).success).toBe(true);
  });

  it("acepta hangul normal (U+3164 es solo el relleno invisible)", () => {
    expect(correctedInvoiceExtractionSchema.safeParse(mutate((draft) => (draft.supplier.name = "한국 식품 ㄱㅏ"))).success).toBe(true);
  });

  it.each(["31/02/2026", "31-02-2026", "29/02/2025", "32/01/2026", "15/13/2026", "00/10/2026", "1/0/2026", "31.04.2026", "30.02.2026"])(
    "rechaza la fecha no ISO imposible %s (DD/MM/AAAA o DD-MM-AAAA, caos N3)",
    (date) => {
      const parsed = correctedInvoiceExtractionSchema.safeParse(mutate((draft) => (draft.date = date)));

      expect(parsed.error?.issues[0]).toMatchObject({ message: INVOICE_IMPOSSIBLE_DATE_MESSAGE, path: ["date"] });
    },
  );

  it.each(["2026/02/31", "2026.04.31", "2026-4-31", "2025/2/29", "2026/13/01", "2026.00.10"])(
    "rechaza la fecha AAAA/MM/DD o AAAA.MM.DD imposible %s (caos N9)",
    (date) => {
      const parsed = correctedInvoiceExtractionSchema.safeParse(mutate((draft) => (draft.date = date)));

      expect(parsed.error?.issues[0]).toMatchObject({ message: INVOICE_IMPOSSIBLE_DATE_MESSAGE, path: ["date"] });
    },
  );

  it.each(["29/02/2024", "14/10/2026", "14-10-2026", "1/2/2026", " 31/12/2026 ", "30.04.2026", "2026/02/28", "2024.2.29", "2026-4-30"])("acepta la fecha no ISO válida %s", (date) => {
    expect(correctedInvoiceExtractionSchema.safeParse(mutate((draft) => (draft.date = date))).success).toBe(true);
  });

  it("rechaza una fecha ISO imposible con mensaje en español; acepta 29 de febrero bisiesto y otros formatos (caos B8)", () => {
    const impossible = correctedInvoiceExtractionSchema.safeParse(mutate((draft) => (draft.date = "2026-02-31")));

    expect(impossible.success).toBe(false);
    expect(impossible.error?.issues[0]).toMatchObject({ message: INVOICE_IMPOSSIBLE_DATE_MESSAGE, path: ["date"] });
    expect(INVOICE_IMPOSSIBLE_DATE_MESSAGE).toMatch(/^La fecha de la factura no existe/);
    expect(correctedInvoiceExtractionSchema.safeParse(mutate((draft) => (draft.date = "2026-13-01"))).success).toBe(false);
    expect(correctedInvoiceExtractionSchema.safeParse(mutate((draft) => (draft.date = "2024-02-29"))).success).toBe(true);
    expect(correctedInvoiceExtractionSchema.safeParse(mutate((draft) => (draft.date = "14/10/2026"))).success).toBe(true);
    // La lectura del modelo no la rechaza: se descarta con aviso en extractInvoice.
    expect(invoiceExtractionSchema.safeParse(mutate((draft) => (draft.date = "2026-02-31"))).success).toBe(true);
  });

  it(`tope de ${INVOICE_MAX_LINES} líneas en invoiceExtractionSchema (auditoría B10)`, () => {
    const lines = (count: number) => mutate((draft) => (draft.lines = Array.from({ length: count }, () => valid.lines[0]!)));

    expect(invoiceExtractionSchema.safeParse(lines(INVOICE_MAX_LINES)).success).toBe(true);
    expect(invoiceExtractionSchema.safeParse(lines(INVOICE_MAX_LINES + 1)).error?.issues[0]).toMatchObject({
      message: `La factura puede tener como máximo ${INVOICE_MAX_LINES} líneas.`,
      path: ["lines"],
    });
  });

  it("rechaza una corrección que confirm_invoice_scan no aceptaría por tamaño (200 líneas × 2×1000)", () => {
    const big = mutate(
      (draft) =>
        (draft.lines = Array.from({ length: 200 }, () => ({
          ...valid.lines[0]!,
          description: "d".repeat(INVOICE_TEXT_MAX_LENGTH),
          rawText: "r".repeat(INVOICE_TEXT_MAX_LENGTH),
        }))),
    );

    expect(invoiceExtractionSchema.safeParse(big).success).toBe(true);
    expect(correctedInvoiceExtractionSchema.safeParse(big).error?.issues[0]?.message).toBe(INVOICE_CORRECTED_TOO_LARGE_MESSAGE);
  });
});
