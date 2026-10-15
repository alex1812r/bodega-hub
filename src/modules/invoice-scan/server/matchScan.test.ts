import type { InvoiceExtraction } from "../contracts";
import { notAnInvoiceExtraction, singlePageExtraction } from "./__fixtures__/extractions";
import { matchScan } from "./matchScan";

const ctx = { dataSource: "mock", storeId: "store-1" } as const;

describe("matchScan (stub hasta SCN-05)", () => {
  it("deja todas las líneas sin emparejar, en modo unidad y sin avisos", async () => {
    const match = await matchScan(singlePageExtraction, ctx);

    expect(match.supplier).toEqual({});
    expect(match.lines).toEqual([
      { entryMode: "unit", index: 0, issues: [], status: "unmatched", taxRateCode: "general" },
      { entryMode: "unit", index: 1, issues: [], status: "unmatched", taxRateCode: "exento" },
    ]);
  });

  it.each([
    ["exento", "exento"],
    ["reducida", "general"],
    ["general", "general"],
    ["unknown", "general"],
    [undefined, "general"],
  ] as const)("taxHint %s → alícuota %s", async (taxHint, expected) => {
    const [line] = singlePageExtraction.lines;
    const extraction: InvoiceExtraction = {
      ...singlePageExtraction,
      lines: [{ ...line!, taxHint }],
    };

    expect((await matchScan(extraction, ctx)).lines[0]?.taxRateCode).toBe(expected);
  });

  it("calcula el total y no marca diferencia si cuadra al céntimo", async () => {
    const match = await matchScan({ ...singlePageExtraction, total: 23465.52 }, ctx);

    expect(match.totals).toEqual({ computed: 23465.52, mismatch: false, read: 23465.52 });
  });

  it("marca la diferencia cuando el total leído se aleja más de 0,01", async () => {
    const match = await matchScan(singlePageExtraction, ctx);

    expect(match.totals).toEqual({ computed: 23465.52, mismatch: true, read: 24138.02 });
  });

  it("sin total leído no hay diferencia; sin líneas el calculado es 0", async () => {
    const match = await matchScan(notAnInvoiceExtraction, ctx);

    expect(match.lines).toEqual([]);
    expect(match.totals).toEqual({ computed: 0, mismatch: false });
  });
});
