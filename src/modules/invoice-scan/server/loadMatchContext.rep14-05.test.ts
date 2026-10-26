/**
 * @jest-environment node
 */
/**
 * REP14-05 (M-qa1401-1) · `loadPreviousScans`: las RPC de escaneos previos (20261026a y 20261019q)
 * devuelven la fecha y el total EFECTIVOS (`date`, `total`: los confirmados si no están vacíos, si
 * no los leídos) y los LEÍDOS (`read_date`, `read_total`); pasan los cuatro a la regla.
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
  id: "5c5c5c5c-0000-4000-8000-000000000005",
  supplier_id: CATIA,
  number: null,
  read_number: null,
  supplier_tax_id: null,
  matched_contact_id: CATIA,
  date: "2026-07-05",
  read_date: "2020-07-05",
  total: "7706.06",
  read_total: "7760.06",
  purchase_id: "purchase-s5",
  purchase: { status: "recibido" },
};

function stub() {
  const rpc = jest.fn(async (_name: string, params: Record<string, unknown>) => ({
    data: Array.isArray(params.p_totals) ? [ROW] : [],
    error: null,
  }));
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => Promise.resolve({ data: [], error: null }),
  };
  return { rpc, from: jest.fn(() => chain) } as unknown as MatchContextSupabaseClient & { rpc: jest.Mock };
}

describe("loadPreviousScans · REP14-05 (fecha y total leídos o confirmados)", () => {
  it.each([
    ["con proveedor (26a)", DUPLICATE_CANDIDATES_RPC, { ids: [CATIA], taxIds: [] }],
    ["sin proveedor (19q)", MATCH_PREVIOUS_SCANS_RPC, undefined],
  ])("%s: trae la fecha y el total efectivos y los leídos", async (_label, rpcName, supplier) => {
    const supabase = stub();

    const scans = await loadPreviousScans(supabase, STORE_ID, { date: "2026-07-05", total: 7706.06 }, undefined, supplier);

    expect(supabase.rpc).toHaveBeenCalledWith(
      rpcName,
      expect.objectContaining({ p_date: "2026-07-05", p_totals: ["7706.05", "7706.06", "7706.07"] }),
    );
    expect(scans).toEqual([
      expect.objectContaining({ scanId: ROW.id, date: "2026-07-05", readDate: "2020-07-05", total: 7706.06, readTotal: 7760.06 }),
    ]);
  });
});
