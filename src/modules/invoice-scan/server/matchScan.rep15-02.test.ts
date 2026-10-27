/**
 * @jest-environment node
 */
/**
 * REP15-02 (B-p16-1, auditoría p16) · la fecha de la factura se normaliza quitando todo espacio
 * Unicode y tabulador en el borde del servidor (`normalizeExtractionForMatch`: lo que se guarda en
 * `extracted` y en `confirmed.extraction`) y viaja a la RPC como clave ISO (`loadPreviousScans`).
 * Antes «05/06/2025\u00a0» se guardaba tal cual y la RPC (solo espacios ASCII) no la casaba.
 */
import type { InvoiceExtraction } from "../contracts";
import { singlePageExtraction } from "./__fixtures__/extractions";
import { DUPLICATE_CANDIDATES_RPC, loadPreviousScans, type MatchContextSupabaseClient } from "./loadMatchContext";
import { normalizeExtractionForMatch } from "./matchScan";

const STORE_ID = "00000000-0000-4000-8000-000000000001";
const CATIA = "12173c27-770a-419f-8867-3289778cfb3b";

function withDate(date: string): InvoiceExtraction {
  return { ...singlePageExtraction, date };
}

describe("normalizeExtractionForMatch · REP15-02 (fecha sin blancos Unicode)", () => {
  it.each([
    ["05/06/2025\u00a0", "05/06/2025"],
    ["\t05/06/2025\n", "05/06/2025"],
    ["\ufeff2025-06-05\u3000", "2025-06-05"],
    ["05 /\u200306/2025", "05/06/2025"],
  ])("%j se guarda como %s", (date, clean) => {
    expect(normalizeExtractionForMatch(withDate(date)).date).toBe(clean);
  });

  it("una fecha de solo blancos queda ausente", () => {
    expect("date" in normalizeExtractionForMatch(withDate("\u00a0\t"))).toBe(false);
  });

  it("sin blancos devuelve la misma referencia", () => {
    const extraction = withDate("2025-06-05");
    expect(normalizeExtractionForMatch(extraction)).toBe(extraction);
  });
});

describe("loadPreviousScans · REP15-02 (p_date como clave ISO)", () => {
  it("la fecha con NBSP o DD/MM/AAAA viaja como AAAA-MM-DD", async () => {
    const rpc = jest.fn(async () => ({ data: [], error: null }));
    const supabase = { rpc, from: jest.fn() } as unknown as MatchContextSupabaseClient;

    await loadPreviousScans(supabase, STORE_ID, { date: "05/06/2025\u00a0", total: 24138.02 }, undefined, {
      ids: [CATIA],
      taxIds: [],
    });

    expect(rpc).toHaveBeenCalledWith(DUPLICATE_CANDIDATES_RPC, expect.objectContaining({ p_date: "2025-06-05" }));
  });
});
