/**
 * REP12-06 (B-qa-rep12-01-1): con el proveedor de la consulta de duplicados, `loadPreviousScans`
 * pide los candidatos a `invoice_duplicate_candidates` (20261026a), que filtra por proveedor ANTES
 * del tope, con los ids y los dígitos de RIF en el cuerpo POST (nunca en la URL, D35).
 */
import {
  DUPLICATE_CANDIDATES_RPC,
  loadPreviousScans,
  MATCH_PREVIOUS_SCANS_RPC,
  type MatchContextSupabaseClient,
} from "./loadMatchContext";

const STORE_ID = "00000000-0000-4000-8000-000000000001";
const CAOS = "c0a05000-0000-4000-8000-000000000001";

function stub(rows: unknown[] = []) {
  const rpc = jest.fn(async () => ({ data: rows, error: null }));
  const query = {
    eq: () => query,
    in: async () => ({ data: [], error: null }),
    select: () => query,
  };
  const from = jest.fn(() => query);
  return { client: { from, rpc } as unknown as MatchContextSupabaseClient, from, rpc };
}

describe("loadPreviousScans · REP12-06", () => {
  it("con proveedor: invoice_duplicate_candidates con ids únicos y dígitos de RIF, por número y por fecha + total", async () => {
    const row = { id: "scan-1", supplier_id: CAOS, number: "0000-1234", supplier_tax_id: null, matched_contact_id: null, date: "2026-10-20", total: "464", purchase_id: null, purchase: null };
    const { client, rpc } = stub([row]);

    const scans = await loadPreviousScans(client, STORE_ID, { number: "00001234", date: "2026-10-20", total: 464 }, "scan-0", {
      ids: [CAOS, CAOS, undefined],
      taxIds: ["j-40999888-1", "J409998881", "", null],
    });

    const supplierParams = { p_supplier_ids: [CAOS], p_tax_digits: ["409998881"] };
    expect(rpc).toHaveBeenCalledWith(DUPLICATE_CANDIDATES_RPC, {
      p_number: "1234",
      p_exclude_scan_id: "scan-0",
      p_limit: 200,
      ...supplierParams,
    });
    expect(rpc).toHaveBeenCalledWith(DUPLICATE_CANDIDATES_RPC, expect.objectContaining({ p_date: "2026-10-20", ...supplierParams }));
    expect(rpc).not.toHaveBeenCalledWith(MATCH_PREVIOUS_SCANS_RPC, expect.anything());
    expect(scans.map((scan) => scan.scanId)).toEqual(["scan-1"]);
  });

  it("con proveedor sin ningún id ni RIF usable: sin candidatos y sin consultar", async () => {
    const { client, rpc } = stub();

    expect(await loadPreviousScans(client, STORE_ID, { number: "1" }, undefined, { ids: [undefined], taxIds: ["--"] })).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sin proveedor (emparejamiento del escaneo): sigue con invoice_match_previous_scans", async () => {
    const { client, rpc } = stub();

    await loadPreviousScans(client, STORE_ID, { number: "1" });

    expect(rpc).toHaveBeenCalledWith(MATCH_PREVIOUS_SCANS_RPC, { p_number: "1", p_exclude_scan_id: null, p_limit: 200 });
  });
});
