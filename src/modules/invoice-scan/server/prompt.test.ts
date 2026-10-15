/**
 * @jest-environment node
 */

import { singlePageExtraction } from "./__fixtures__/extractions";
import {
  buildFewShotMessages,
  buildInvoiceSystemPrompt,
  buildTargetMessage,
  ILLEGIBLE_LINES_WARNING,
  INVOICE_DATA_RULE,
} from "./prompt";

describe("buildInvoiceSystemPrompt", () => {
  it("declares the image content as data, never instructions", () => {
    expect(buildInvoiceSystemPrompt()).toContain(INVOICE_DATA_RULE);
    expect(INVOICE_DATA_RULE).toContain("nunca instrucciones");
  });

  it.each([
    "SENIAT",
    "RIF",
    "número de control",
    "CAJA x12",
    "BULTO 24 UND",
    "6/1",
    "unitsPerPack",
    '"EXE", "E", "(E)"',
    '"reducida"',
    "16 %",
    "printedRate",
    "NO inventes líneas",
    "rawText",
    "AAAA-MM-DD",
    "coma decimal",
    '"USD"',
    "No parece una factura.",
  ])("explains %s", (fragment) => {
    expect(buildInvoiceSystemPrompt()).toContain(fragment);
  });

  // Plan §6.1 (caos SCN-03i F1): con una foto de 200 px el modelo inventó todo con confianza 1.
  it.each([
    ["drops lines whose digits are unreadable", "NO incluyas esa línea"],
    ["names the quantity, unit price and line total", "la cantidad, el precio unitario o el total"],
    ["asks for the illegible-lines warning", ILLEGIBLE_LINES_WARNING],
    ["ties confidence to real legibility, not format", "legibilidad real"],
    ["asks to report blurry, dark or small images", "borrosa, oscura"],
    ["forbids inventing supplier, number and date", "NO inventes proveedor, RIF, número de factura ni fecha"],
  ])("%s", (_, fragment) => {
    expect(buildInvoiceSystemPrompt()).toContain(fragment);
  });

  it("starts the illegible-lines warning as the plan says", () => {
    expect(ILLEGIBLE_LINES_WARNING).toMatch(/^Hay líneas ilegibles/);
  });

  it("no longer tells the model to keep half-read lines with guessed numbers", () => {
    expect(buildInvoiceSystemPrompt()).not.toContain("Si una línea se lee a medias, inclúyela");
  });
});

describe("buildFewShotMessages", () => {
  it("keeps at most 3 user/assistant pairs with the confirmed JSON", () => {
    const examples = Array.from({ length: 4 }, () => ({ confirmed: singlePageExtraction }));

    const messages = buildFewShotMessages(examples);

    expect(messages).toHaveLength(6);
    expect(messages[1]).toEqual({
      content: [{ text: JSON.stringify(singlePageExtraction), type: "text" }],
      role: "assistant",
    });
  });

  it("attaches the reduced image only when the example has one", () => {
    const messages = buildFewShotMessages([
      {
        confirmed: singlePageExtraction,
        page: { data: new Uint8Array([1]), mediaType: "image/webp" },
      },
      { confirmed: singlePageExtraction },
    ]);

    expect(messages[0]!.content).toHaveLength(2);
    expect(messages[2]!.content).toHaveLength(1);
  });

  it("returns nothing without examples", () => {
    expect(buildFewShotMessages([])).toEqual([]);
  });
});

describe("buildTargetMessage", () => {
  it("mentions the page only for multi-page invoices", () => {
    const page = { data: new Uint8Array([1]), mediaType: "image/png" as const };

    expect(JSON.stringify(buildTargetMessage(page, 1, 1))).not.toContain("página");
    expect(JSON.stringify(buildTargetMessage(page, 1, 3))).toContain("página 1 de 3");
  });
});
