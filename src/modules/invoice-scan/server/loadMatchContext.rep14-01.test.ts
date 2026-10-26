/**
 * @jest-environment node
 */
/**
 * REP14-01 intento 2 (M-p15-1, D63) · `loadPreviousScans`: las RPC de escaneos previos
 * (`invoice_duplicate_candidates` 20261026a e `invoice_match_previous_scans` 20261019q) devuelven
 * el número EFECTIVO (`number`) y el LEÍDO (`read_number`); la búsqueda por número conserva la fila
 * si casa cualquiera de los dos y los pasa a la regla (`number`, `readNumber`).
 */
import {
  DUPLICATE_CANDIDATES_RPC,
  loadPreviousScans,
  MATCH_PREVIOUS_SCANS_RPC,
  type MatchContextSupabaseClient,
} from "./loadMatchContext";

const STORE_ID = "00000000-0000-4000-8000-000000000001";
const CATIA = "12173c27-770a-419f-8867-3289778cfb3b";

const ROW = {
  id: "bcedc901-0000-4000-8000-000000000001",
  supplier_id: CATIA,
  number: "00001028",
  read_number: "00901028",
  supplier_tax_id: null,
  matched_contact_id: CATIA,
  date: "2026-10-08",
  total: "315708.83",
  purchase_id: "purchase-f12",
  purchase: { status: "recibido" },
};

function stub() {
  const rpc = jest.fn(async (_name: string, params: Record<string, unknown>) => ({
    data: typeof params.p_number === "string" ? [ROW] : [],
    error: null,
  }));
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => Promise.resolve({ data: [], error: null }),
  };
  return { rpc, from: jest.fn(() => chain) } as unknown as MatchContextSupabaseClient & { rpc: jest.Mock };
}

describe("loadPreviousScans · REP14-01 (número leído o efectivo)", () => {
  it.each([
    ["con proveedor (26a)", DUPLICATE_CANDIDATES_RPC, { ids: [CATIA], taxIds: [] }],
    ["sin proveedor (19q)", MATCH_PREVIOUS_SCANS_RPC, undefined],
  ])("%s: el actual con el número LEÍDO del previo lo conserva y trae ambos números", async (_label, rpcName, supplier) => {
    const supabase = stub();

    const scans = await loadPreviousScans(supabase, STORE_ID, { number: "00901028" }, undefined, supplier);

    expect(supabase.rpc).toHaveBeenCalledWith(rpcName, expect.objectContaining({ p_number: "901028" }));
    expect(scans).toEqual([
      expect.objectContaining({ scanId: ROW.id, number: "00001028", readNumber: "00901028" }),
    ]);
  });

  it("con el número EFECTIVO también lo conserva", async () => {
    const supabase = stub();

    const scans = await loadPreviousScans(supabase, STORE_ID, { number: "00001028" }, undefined, { ids: [CATIA], taxIds: [] });

    expect(scans.map((scan) => scan.scanId)).toEqual([ROW.id]);
  });
});
