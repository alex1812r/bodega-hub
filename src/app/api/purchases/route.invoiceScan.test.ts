/**
 * @jest-environment node
 */
/**
 * SCN-06 · `invoiceScanId` en `POST /api/purchases` (plan factura-escaneo §3, §5.2;
 * caos 6.10 y 6.14): el escaneo se valida antes de crear la compra, se confirma y
 * se aprende después con el texto GUARDADO, y un fallo del aprendizaje no rompe
 * la compra.
 */

jest.mock("../../../lib/supabase/route-client", () => ({
  createRouteSupabaseClient: jest.fn(),
}));

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import {
  getMockInvoiceScan,
  listMockLearnedAliases,
  registerMockInvoiceScan,
  resetMockInvoiceScans,
} from "@/modules/invoice-scan/server/confirmScan.mock-server";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { POST } from "./route";

const OTHER_STORE_ID = "00000000-0000-4000-8000-000000000002";
const SCAN_ID = "5a0e1b2c-3d4e-4f5a-8b6c-7d8e9f0a1b2c";
const PURCHASE_KEY = "7a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";
const OTHER_PURCHASE_KEY = "9c3d4e5f-6a7b-4c8d-8e9f-0a1b2c3d4e5f";
const PRODUCT_A = "11111111-1111-4111-8111-111111111111";
const PRODUCT_B = "22222222-2222-4222-8222-222222222222";
const SUPPLIER_ID = "33333333-3333-4333-8333-333333333333";

const extracted = {
  lines: [
    { rawText: "REF.MALTA 1.5 X6" },
    { rawText: "AZÚCAR  Montalbán" },
    { rawText: "***" },
  ],
};

const purchase = {
  discountRef: 0,
  discountVes: 0,
  items: [
    {
      costCurrency: "ref",
      entryMode: "unit",
      productId: "prod-cable",
      quantity: 2,
      subtotalRef: 4,
      subtotalVes: 2040,
      taxRate: 0,
      taxRef: 0,
      taxVes: 0,
      unitCostRef: 2,
      unitCostVes: 1020,
    },
  ],
  refRateVes: 510,
  subtotalRef: 4,
  subtotalVes: 2040,
  supplierId: "cont-supplier",
  taxRef: 0,
  taxVes: 0,
};

const scanLines = [
  { lineIndex: 0, packLabel: "Caja", productId: PRODUCT_A, unitsPerPack: 6 },
  { lineIndex: 1, productId: PRODUCT_B },
  // "***" normaliza a "": no se aprende.
  { lineIndex: 2, productId: PRODUCT_B },
  // Fuera de rango: se omite.
  { lineIndex: 9, productId: PRODUCT_A },
];

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/purchases", {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", "x-demo-role": "almacen", ...headers },
      method: "POST",
    }),
  );
}

type FakeScan = {
  extracted: unknown;
  id: string;
  purchase_id: string | null;
  status: string;
  store_id: string;
};

type FakeState = {
  failConfirm?: boolean;
  failLearn?: boolean;
  purchases: { client_request_id: string | null; id: string; store_id: string; supplier_id: string }[];
  scans: FakeScan[];
};

/** Cliente Supabase mínimo: lecturas con filtros `eq` y las RPC del flujo. */
function createFake(state: FakeState) {
  const rpc = jest.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "create_purchase") {
      const key = (args.p_client_request_id as string | undefined) ?? null;
      const previous = key
        ? state.purchases.find((row) => row.store_id === DEFAULT_STORE_ID && row.client_request_id === key)
        : undefined;
      const row = previous ?? {
        client_request_id: key,
        id: `00000000-0000-4000-8000-0000000001${String(state.purchases.length).padStart(2, "0")}`,
        store_id: DEFAULT_STORE_ID,
        supplier_id: SUPPLIER_ID,
      };

      if (!previous) {
        state.purchases.push(row);
      }

      return { data: { ...row, status: "recibido", total_ref: 4 }, error: null };
    }

    if (name === "confirm_invoice_scan") {
      if (state.failConfirm) {
        return { data: null, error: { code: "PT409", message: "El escaneo ya fue confirmado" } };
      }

      const scan = state.scans.find((row) => row.id === args.p_scan_id);

      if (scan) {
        scan.status = "confirmed";
        scan.purchase_id = args.p_purchase_id as string;
      }

      return { data: null, error: null };
    }

    if (name === "learn_invoice_aliases") {
      return state.failLearn
        ? { data: null, error: { code: "PT500", message: "boom" } }
        : { data: (args.p_lines as unknown[]).length, error: null };
    }

    throw new Error(`RPC inesperada ${name}`);
  });

  function from(table: string) {
    const filters: Record<string, unknown> = {};
    const builder = {
      eq(column: string, value: unknown) {
        filters[column] = value;
        return builder;
      },
      async maybeSingle() {
        const rows: Record<string, unknown>[] =
          table === "invoice_scans" ? state.scans : table === "purchases" ? state.purchases : [];
        const match = rows.find((row) =>
          Object.entries(filters).every(([column, value]) => row[column] === value),
        );

        return { data: match ?? null, error: null };
      },
      select() {
        return builder;
      },
    };

    return builder;
  }

  return {
    client: {
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
      from: jest.fn(from),
      rpc,
    },
    rpcNames: () => rpc.mock.calls.map(([name]) => name),
    rpc,
  };
}

describe("/api/purchases · invoiceScanId (SCN-06)", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  describe("supabase", () => {
    let state: FakeState;
    let fake: ReturnType<typeof createFake>;

    beforeEach(() => {
      process.env.API_DATA_SOURCE = "supabase";
      state = {
        purchases: [],
        scans: [
          { extracted, id: SCAN_ID, purchase_id: null, status: "extracted", store_id: DEFAULT_STORE_ID },
        ],
      };
      fake = createFake(state);
      (createRouteSupabaseClient as jest.Mock).mockResolvedValue(fake.client);
      jest.spyOn(console, "error").mockImplementation(() => undefined);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("escaneo ok: 201, confirm con el JSON confirmado y UN learn con el alias del rawText guardado", async () => {
      const response = await post({
        ...purchase,
        clientRequestId: PURCHASE_KEY,
        invoiceScanId: SCAN_ID,
        invoiceScanLines: scanLines,
      });
      const payload = await response.json();
      const purchaseId = payload.data.id;

      expect(response.status).toBe(201);
      expect(payload.data.invoiceScan).toEqual({ confirmed: true, learned: 2 });
      expect(fake.rpcNames()).toEqual(["create_purchase", "confirm_invoice_scan", "learn_invoice_aliases"]);

      const confirmArgs = fake.rpc.mock.calls[1][1];
      expect(confirmArgs).toEqual({
        p_confirmed: {
          confirmedAt: expect.any(String),
          lines: [
            { ...scanLines[0], aliasNorm: "ref malta 1 5 x6", rawText: "REF.MALTA 1.5 X6" },
            { ...scanLines[1], aliasNorm: "azucar montalban", rawText: "AZÚCAR  Montalbán" },
            { ...scanLines[2], aliasNorm: "", rawText: "***" },
          ],
          purchaseId,
          supplierId: SUPPLIER_ID,
        },
        p_purchase_id: purchaseId,
        p_scan_id: SCAN_ID,
      });
      expect(fake.rpc.mock.calls[2][1]).toEqual({
        p_lines: [
          { alias_norm: "ref malta 1 5 x6", pack_label: "Caja", product_id: PRODUCT_A, units_per_pack: 6 },
          { alias_norm: "azucar montalban", pack_label: null, product_id: PRODUCT_B, units_per_pack: null },
        ],
        p_scan_id: SCAN_ID,
      });
      // El escaneo se lee con filtro explícito por tienda.
      expect(fake.client.from).toHaveBeenCalledWith("invoice_scans");
    });

    it("si learn falla la compra sigue siendo 201 y se registra el error", async () => {
      state.failLearn = true;

      const response = await post({ ...purchase, invoiceScanId: SCAN_ID, invoiceScanLines: scanLines });
      const payload = await response.json();

      expect(response.status).toBe(201);
      expect(payload.data.id).toBeDefined();
      expect(payload.data.invoiceScan).toEqual({ confirmed: true, learned: null });
      expect(console.error).toHaveBeenCalledWith(
        "[invoice-scan] learn falló; la compra quedó creada",
        expect.objectContaining({ scanId: SCAN_ID }),
      );
    });

    it("si confirm falla: 201, learn NO se llama", async () => {
      state.failConfirm = true;

      const response = await post({ ...purchase, invoiceScanId: SCAN_ID, invoiceScanLines: scanLines });

      expect(response.status).toBe(201);
      expect((await response.json()).data.invoiceScan).toEqual({ confirmed: false, learned: null });
      expect(fake.rpcNames()).toEqual(["create_purchase", "confirm_invoice_scan"]);
    });

    it("escaneo de otra tienda: 400 y create_purchase NO se llama", async () => {
      state.scans[0].store_id = OTHER_STORE_ID;

      const response = await post({ ...purchase, invoiceScanId: SCAN_ID, invoiceScanLines: scanLines });
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(payload.error.message).toBe("Escaneo no encontrado");
      expect(fake.rpc).not.toHaveBeenCalled();
    });

    it("ya confirmado con otra compra: 400 sin crear", async () => {
      state.purchases.push({
        client_request_id: OTHER_PURCHASE_KEY,
        id: "00000000-0000-4000-8000-000000000999",
        store_id: DEFAULT_STORE_ID,
        supplier_id: SUPPLIER_ID,
      });
      state.scans[0].status = "confirmed";
      state.scans[0].purchase_id = "00000000-0000-4000-8000-000000000999";

      const response = await post({
        ...purchase,
        clientRequestId: PURCHASE_KEY,
        invoiceScanId: SCAN_ID,
        invoiceScanLines: scanLines,
      });

      expect(response.status).toBe(400);
      expect((await response.json()).error.message).toBe("El escaneo ya fue confirmado");
      expect(fake.rpc).not.toHaveBeenCalled();
    });

    it("descartado: 400 sin crear", async () => {
      state.scans[0].status = "discarded";

      const response = await post({ ...purchase, invoiceScanId: SCAN_ID });

      expect(response.status).toBe(400);
      expect(fake.rpc).not.toHaveBeenCalled();
    });

    it("replay con el mismo clientRequestId: misma compra y learn NO se vuelve a llamar", async () => {
      const body = { ...purchase, clientRequestId: PURCHASE_KEY, invoiceScanId: SCAN_ID, invoiceScanLines: scanLines };

      const first = await (await post(body)).json();
      fake.rpc.mockClear();
      const secondResponse = await post(body);
      const second = await secondResponse.json();

      expect(secondResponse.status).toBe(201);
      expect(second.data.id).toBe(first.data.id);
      expect(second.data.invoiceScan).toEqual({ confirmed: true, learned: null });
      expect(fake.rpcNames()).toEqual(["create_purchase"]);
    });

    it("sin invoiceScanId: no lee escaneos, no llama confirm/learn y la respuesta no trae invoiceScan", async () => {
      const response = await post({ ...purchase, clientRequestId: PURCHASE_KEY });
      const payload = await response.json();

      expect(response.status).toBe(201);
      expect(payload.data).not.toHaveProperty("invoiceScan");
      expect(fake.rpcNames()).toEqual(["create_purchase"]);
      expect(fake.client.from).not.toHaveBeenCalledWith("invoice_scans");
    });
  });

  describe("cuerpo", () => {
    beforeEach(() => {
      process.env.API_DATA_SOURCE = "mock";
      resetMockInvoiceScans();
    });

    it.each([
      ["líneas sin invoiceScanId", { invoiceScanLines: scanLines }],
      ["invoiceScanId que no es uuid", { invoiceScanId: "no-uuid" }],
      ["productId que no es uuid", { invoiceScanId: SCAN_ID, invoiceScanLines: [{ lineIndex: 0, productId: "prod-a" }] }],
      ["lineIndex negativo", { invoiceScanId: SCAN_ID, invoiceScanLines: [{ lineIndex: -1, productId: PRODUCT_A }] }],
      ["unitsPerPack 0", { invoiceScanId: SCAN_ID, invoiceScanLines: [{ lineIndex: 0, productId: PRODUCT_A, unitsPerPack: 0 }] }],
      [
        "más de 500 líneas",
        { invoiceScanId: SCAN_ID, invoiceScanLines: Array.from({ length: 501 }, () => ({ lineIndex: 0, productId: PRODUCT_A })) },
      ],
    ])("400 con %s", async (_caso, extra) => {
      const response = await post({ ...purchase, ...extra });

      expect(response.status).toBe(400);
    });
  });

  describe("mock", () => {
    beforeEach(() => {
      process.env.API_DATA_SOURCE = "mock";
      resetMockInvoiceScans();
    });

    it("confirma, aprende y el replay devuelve la misma compra sin sumar hits", async () => {
      registerMockInvoiceScan({ extracted, id: SCAN_ID });
      const body = {
        ...purchase,
        clientRequestId: "6f1e2d3c-4b5a-4968-8776-655443322110",
        invoiceScanId: SCAN_ID,
        invoiceScanLines: scanLines,
      };

      const first = await post(body);
      const firstPayload = await first.json();
      const second = await post(body);
      const secondPayload = await second.json();

      expect([first.status, second.status]).toEqual([201, 201]);
      expect(firstPayload.data.invoiceScan).toEqual({ confirmed: true, learned: 2 });
      expect(secondPayload.data.id).toBe(firstPayload.data.id);
      expect(secondPayload.data.invoiceScan).toEqual({ confirmed: true, learned: null });
      expect(getMockInvoiceScan(SCAN_ID)?.purchaseId).toBe(firstPayload.data.id);
      expect(listMockLearnedAliases(DEFAULT_STORE_ID).map((alias) => [alias.aliasNorm, alias.hits])).toEqual([
        ["ref malta 1 5 x6", 1],
        ["azucar montalban", 1],
      ]);
    });

    it("escaneo de otra tienda: 400", async () => {
      registerMockInvoiceScan({ extracted, id: SCAN_ID, storeId: OTHER_STORE_ID });

      const response = await post({ ...purchase, invoiceScanId: SCAN_ID });

      expect(response.status).toBe(400);
      expect(getMockInvoiceScan(SCAN_ID)?.status).toBe("extracted");
    });
  });
});
