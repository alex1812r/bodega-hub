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
import {
  INVOICE_TEXT_INVALID_MESSAGE,
  INVOICE_TEXT_MAX_LENGTH,
  type InvoiceExtraction,
} from "@/modules/invoice-scan/contracts";
import {
  INVOICE_SCAN_KEY_REUSED_MESSAGE,
  type ConfirmedInvoiceScan,
} from "@/modules/invoice-scan/server/confirmScan.server";
import { parseConfirmedScan } from "@/modules/invoice-scan/server/scans.types";
import { createdMockPurchases, findMockPurchase } from "@/modules/purchases/services/purchaseMockStore";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { POST } from "./route";

const OTHER_STORE_ID = "00000000-0000-4000-8000-000000000002";
const SCAN_ID = "5a0e1b2c-3d4e-4f5a-8b6c-7d8e9f0a1b2c";
const PURCHASE_KEY = "7a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";
const OTHER_PURCHASE_KEY = "9c3d4e5f-6a7b-4c8d-8e9f-0a1b2c3d4e5f";
const PRODUCT_A = "11111111-1111-4111-8111-111111111111";
const PRODUCT_B = "22222222-2222-4222-8222-222222222222";
const SUPPLIER_ID = "33333333-3333-4333-8333-333333333333";
const OUTSIDE_PRODUCT = "44444444-4444-4444-8444-444444444444";
const OTHER_SCAN_ID = "6b1f2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3e";

const extractedLine = (rawText: string) => ({
  confidence: 0.9,
  description: rawText,
  lineTotal: 1020,
  quantity: 1,
  rawText,
  unitPrice: 1020,
});

/** Lectura guardada del escaneo (InvoiceExtraction válida). */
const extracted: InvoiceExtraction = {
  confidence: 0.9,
  currency: "VES",
  lines: [extractedLine("REF.MALTA 1.5 X6"), extractedLine("AZÚCAR  Montalbán"), extractedLine("***")],
  supplier: { name: "Distribuidora Lab" },
  warnings: [],
};

/** La misma lectura corregida por el usuario (D10): otra cantidad y el RIF que el modelo no leyó. */
const corrected: InvoiceExtraction = {
  ...extracted,
  lines: [{ ...extracted.lines[0]!, quantity: 2, lineTotal: 2040 }, ...extracted.lines.slice(1)],
  supplier: { name: "Distribuidora Lab", taxId: "J-12345678-9" },
};

const purchase = {
  discountRef: 0,
  discountVes: 0,
  // Las líneas del escaneo apuntan a productos de la compra (SCN-06-F2 · M3):
  // PRODUCT_A en modo empaque (Caja x6) y PRODUCT_B en modo unidad.
  items: [
    {
      costCurrency: "ref",
      entryMode: "pack",
      packCostRef: 2,
      packCostVes: 1020,
      packCount: 1,
      packLabel: "Caja",
      productId: PRODUCT_A,
      subtotalRef: 2,
      subtotalVes: 1020,
      taxRate: 0,
      taxRef: 0,
      taxVes: 0,
      unitCostRef: 0.33,
      unitCostVes: 170,
      unitsPerPack: 6,
    },
    {
      costCurrency: "ref",
      entryMode: "unit",
      productId: PRODUCT_B,
      quantity: 2,
      subtotalRef: 2,
      subtotalVes: 1020,
      taxRate: 0,
      taxRef: 0,
      taxVes: 0,
      unitCostRef: 1,
      unitCostVes: 510,
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
  claim_request_id?: string | null;
  /** Reloj lógico del último reclamo (`claimed_at`). */
  claimed_at?: number | null;
  /** Reloj lógico del primer reclamo de la clave (`claim_started_at`, INT-01). */
  claim_started_at?: number | null;
  extracted: unknown;
  id: string;
  /** Reloj lógico de `learned_at` (CIE-06: el replay reintenta learn si sigue null). */
  learned_at?: number | null;
  purchase_id: string | null;
  status: string;
  store_id: string;
};

type FakeState = {
  failConfirm?: boolean;
  failCreate?: boolean;
  failLearn?: boolean;
  purchases: {
    client_request_id: string | null;
    /** Reloj lógico de `created_at`. */
    created_at?: number;
    id: string;
    store_id: string;
    supplier_id: string;
  }[];
  scans: FakeScan[];
};

/** Cliente Supabase mínimo: lecturas con filtros `eq` y las RPC del flujo. */
function createFake(state: FakeState) {
  // Reloj lógico: cada RPC es una transacción con su propio now().
  let clock = 0;
  const rpc = jest.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "claim_invoice_scan") {
      // Espejo de claim_invoice_scan (20261019b): un único UPDATE condicional.
      const key = args.p_client_request_id as string;
      const scan = state.scans.find((row) => row.id === args.p_scan_id && row.store_id === DEFAULT_STORE_ID);

      if (!scan) {
        return { data: null, error: { code: "PT404", message: "Escaneo no encontrado" } };
      }

      if (scan.status === "confirmed") {
        const own = state.purchases.find(
          (row) => row.store_id === DEFAULT_STORE_ID && row.client_request_id === key,
        );
        return own && own.id === scan.purchase_id
          ? { data: "replay", error: null }
          : { data: null, error: { code: "PT409", message: "El escaneo ya fue confirmado" } };
      }

      if (scan.status !== "extracted") {
        return { data: null, error: { code: "PT409", message: "El escaneo no está disponible" } };
      }

      if (scan.claim_request_id && scan.claim_request_id !== key) {
        return {
          data: null,
          error: { code: "PT409", message: "El escaneo se está confirmando en otra compra" },
        };
      }

      // INT-01: cada reclamo renueva claimed_at; el mismo intento conserva claim_started_at (SCN-06-F3).
      scan.claimed_at = ++clock;
      if (scan.claim_request_id !== key || scan.claim_started_at == null) {
        scan.claim_started_at = scan.claimed_at;
      }
      scan.claim_request_id = key;
      return { data: "claimed", error: null };
    }

    if (name === "release_invoice_scan_claim") {
      const scan = state.scans.find((row) => row.id === args.p_scan_id);

      if (scan && scan.status === "extracted" && scan.claim_request_id === args.p_client_request_id) {
        scan.claim_request_id = null;
        scan.claimed_at = null;
        scan.claim_started_at = null;
      }

      return { data: null, error: null };
    }

    if (name === "create_purchase") {
      if (state.failCreate) {
        return { data: null, error: { code: "PT400", message: "Proveedor no encontrado" } };
      }

      const key = (args.p_client_request_id as string | undefined) ?? null;
      const previous = key
        ? state.purchases.find((row) => row.store_id === DEFAULT_STORE_ID && row.client_request_id === key)
        : undefined;
      const row = previous ?? {
        client_request_id: key,
        created_at: ++clock,
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

      if (!scan || scan.claim_request_id !== args.p_client_request_id) {
        return {
          data: null,
          error: { code: "PT409", message: "El escaneo se está confirmando en otra compra" },
        };
      }

      // Espejo de SCN-06-F2 · M1: la compra debe ser la de esta clave y no tener otro escaneo.
      const target = state.purchases.find((row) => row.id === args.p_purchase_id);

      // SCN-06-F3: y creada después del reclamo (no una compra vieja de la misma clave).
      if (
        target?.client_request_id !== args.p_client_request_id ||
        scan.claim_started_at == null ||
        (target?.created_at ?? 0) < scan.claim_started_at
      ) {
        return { data: null, error: { code: "PT409", message: "La compra no corresponde a este intento" } };
      }

      if (state.scans.some((row) => row.id !== scan.id && row.purchase_id === args.p_purchase_id)) {
        return { data: null, error: { code: "PT409", message: "La compra ya está ligada a otro escaneo" } };
      }

      scan.status = "confirmed";
      scan.purchase_id = args.p_purchase_id as string;
      scan.claim_request_id = null;
      scan.claimed_at = null;
      scan.claim_started_at = null;

      return { data: true, error: null };
    }

    if (name === "learn_invoice_aliases") {
      if (state.failLearn) {
        return { data: null, error: { code: "PT500", message: "boom" } };
      }

      // Espejo de la forma que exige la RPC: una etiqueta de más de 100 caracteres
      // rechaza la llamada entera (PT400).
      const lines = args.p_lines as { pack_label?: string | null }[];
      const tooLong = lines.findIndex((line) => Array.from(line.pack_label?.trim() ?? "").length > 100);

      if (tooLong >= 0) {
        return {
          data: null,
          error: { code: "PT400", message: `Etiqueta de empaque inválida en la línea ${tooLong + 1}` },
        };
      }

      // Como la RPC (SCN-06-F2 M2): aprende una sola vez por escaneo (learned_at).
      const learnedScan = state.scans.find((row) => row.id === args.p_scan_id);

      if (learnedScan?.learned_at != null) {
        return { data: 0, error: null };
      }

      if (learnedScan) {
        learnedScan.learned_at = ++clock;
      }

      return { data: lines.length, error: null };
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
      expect(fake.rpcNames()).toEqual([
        "claim_invoice_scan",
        "create_purchase",
        "confirm_invoice_scan",
        "learn_invoice_aliases",
      ]);
      expect(fake.rpc.mock.calls[0][1]).toEqual({ p_client_request_id: PURCHASE_KEY, p_scan_id: SCAN_ID });

      const confirmArgs = fake.rpc.mock.calls[2][1];
      expect(confirmArgs).toEqual({
        p_confirmed: {
          confirmedAt: expect.any(String),
          // D10: sin invoiceScanExtraction, la extracción es la guardada en el escaneo.
          extraction: extracted,
          lines: [
            { ...scanLines[0], aliasNorm: "ref malta 1 5 x6", rawText: "REF.MALTA 1.5 X6" },
            { ...scanLines[1], aliasNorm: "azucar montalban", rawText: "AZÚCAR  Montalbán" },
            { ...scanLines[2], aliasNorm: "", rawText: "***" },
          ],
          purchaseId,
          supplierId: SUPPLIER_ID,
        },
        p_client_request_id: PURCHASE_KEY,
        p_purchase_id: purchaseId,
        p_scan_id: SCAN_ID,
      });
      expect(fake.rpc.mock.calls[3][1]).toEqual({
        p_lines: [
          { alias_norm: "ref malta 1 5 x6", pack_label: "Caja", product_id: PRODUCT_A, units_per_pack: 6 },
          { alias_norm: "azucar montalban", pack_label: null, product_id: PRODUCT_B, units_per_pack: null },
        ],
        p_scan_id: SCAN_ID,
      });
      // El escaneo se lee con filtro explícito por tienda.
      expect(fake.client.from).toHaveBeenCalledWith("invoice_scans");
    });

    it("D10: invoiceScanExtraction (corregida) se guarda en confirmed.extraction; el alias sigue saliendo del rawText guardado", async () => {
      const response = await post({
        ...purchase,
        clientRequestId: PURCHASE_KEY,
        invoiceScanExtraction: { ...corrected, lines: [{ ...corrected.lines[0]!, rawText: "OTRO TEXTO" }, ...corrected.lines.slice(1)] },
        invoiceScanId: SCAN_ID,
        invoiceScanLines: [{ lineIndex: 0, packLabel: null, productId: PRODUCT_A, unitsPerPack: null }, scanLines[1]],
      });

      expect(response.status).toBe(201);
      const confirmed = fake.rpc.mock.calls.find(([name]) => name === "confirm_invoice_scan")![1].p_confirmed as ConfirmedInvoiceScan;
      expect(confirmed.extraction?.lines[0]).toMatchObject({ quantity: 2, rawText: "OTRO TEXTO" });
      expect(confirmed.extraction?.supplier.taxId).toBe("J-12345678-9");
      // Las claves de empaque en null (modo unidad) no viajan: D10 solo admite string / entero.
      expect(confirmed.lines).toEqual([
        { aliasNorm: "ref malta 1 5 x6", lineIndex: 0, productId: PRODUCT_A, rawText: "REF.MALTA 1.5 X6" },
        { aliasNorm: "azucar montalban", lineIndex: 1, productId: PRODUCT_B, rawText: "AZÚCAR  Montalbán" },
      ]);
    });

    it("D10 ida y vuelta: lo que confirm guarda lo lee parseConfirmedScan (few-shot) sin perder nada", async () => {
      await post({
        ...purchase,
        clientRequestId: PURCHASE_KEY,
        invoiceScanExtraction: corrected,
        invoiceScanId: SCAN_ID,
        // Línea en modo unidad con las claves de empaque en null: se omiten al guardar.
        invoiceScanLines: [scanLines[0], { lineIndex: 1, packLabel: null, productId: PRODUCT_B, unitsPerPack: null }, scanLines[2]],
      });

      const confirmed = fake.rpc.mock.calls.find(([name]) => name === "confirm_invoice_scan")![1].p_confirmed;
      const parsed = parseConfirmedScan(JSON.parse(JSON.stringify(confirmed)));

      expect(parsed).not.toBeNull();
      expect(parsed!.extraction).toEqual(corrected);
      expect(parsed!.lines).toEqual([
        { lineIndex: 0, packLabel: "Caja", productId: PRODUCT_A, unitsPerPack: 6 },
        { lineIndex: 1, productId: PRODUCT_B },
        { lineIndex: 2, productId: PRODUCT_B },
      ]);
    });

    it("si learn falla la compra sigue siendo 201 y se registra el error", async () => {
      state.failLearn = true;

      const response = await post({ ...purchase, clientRequestId: PURCHASE_KEY, invoiceScanId: SCAN_ID, invoiceScanLines: scanLines });
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

      const response = await post({ ...purchase, clientRequestId: PURCHASE_KEY, invoiceScanId: SCAN_ID, invoiceScanLines: scanLines });

      expect(response.status).toBe(201);
      expect((await response.json()).data.invoiceScan).toEqual({ confirmed: false, learned: null });
      expect(fake.rpcNames()).toEqual(["claim_invoice_scan", "create_purchase", "confirm_invoice_scan"]);
    });

    it("escaneo de otra tienda: 400 y create_purchase NO se llama", async () => {
      state.scans[0].store_id = OTHER_STORE_ID;

      const response = await post({ ...purchase, clientRequestId: PURCHASE_KEY, invoiceScanId: SCAN_ID, invoiceScanLines: scanLines });
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(payload.error.message).toBe("Escaneo no encontrado");
      expect(fake.rpcNames()).not.toContain("create_purchase");
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
      expect(fake.rpcNames()).not.toContain("create_purchase");
    });

    it("descartado: 400 sin crear", async () => {
      state.scans[0].status = "discarded";

      const response = await post({ ...purchase, clientRequestId: PURCHASE_KEY, invoiceScanId: SCAN_ID });

      expect(response.status).toBe(400);
      expect(fake.rpcNames()).not.toContain("create_purchase");
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
      expect(fake.rpcNames()).toEqual(["claim_invoice_scan", "create_purchase"]);
    });

    it("8 intentos concurrentes con claves distintas: una sola compra; el resto 400 sin create_purchase (SCN-06-F1)", async () => {
      const keys = Array.from({ length: 8 }, () => crypto.randomUUID());

      const responses = await Promise.all(
        keys.map((clientRequestId) =>
          post({ ...purchase, clientRequestId, invoiceScanId: SCAN_ID, invoiceScanLines: scanLines }),
        ),
      );
      const statuses = responses.map((response) => response.status).sort();
      const rejected = await Promise.all(
        responses
          .filter((response) => response.status === 400)
          .map(async (response) => (await response.json()).error.message as string),
      );

      expect(statuses).toEqual([201, 400, 400, 400, 400, 400, 400, 400]);
      expect(fake.rpcNames().filter((name) => name === "create_purchase")).toHaveLength(1);
      expect(state.purchases).toHaveLength(1);
      for (const message of rejected) {
        expect(["El escaneo se está confirmando en otra compra", "El escaneo ya fue confirmado"]).toContain(message);
      }
      expect(state.scans[0]).toMatchObject({ purchase_id: state.purchases[0].id, status: "confirmed" });
    });

    it("reclamo vigente de otro intento: 400 y create_purchase NO se llama", async () => {
      state.scans[0].claim_request_id = OTHER_PURCHASE_KEY;

      const response = await post({ ...purchase, clientRequestId: PURCHASE_KEY, invoiceScanId: SCAN_ID });

      expect(response.status).toBe(400);
      expect((await response.json()).error.message).toBe("El escaneo se está confirmando en otra compra");
      expect(fake.rpcNames()).toEqual(["claim_invoice_scan"]);
    });

    it("create_purchase rechazada: libera el reclamo y otra clave puede reintentar", async () => {
      state.failCreate = true;

      const failed = await post({ ...purchase, clientRequestId: PURCHASE_KEY, invoiceScanId: SCAN_ID });

      expect(failed.status).toBe(400);
      expect(fake.rpcNames()).toEqual(["claim_invoice_scan", "create_purchase", "release_invoice_scan_claim"]);
      expect(fake.rpc.mock.calls[2][1]).toEqual({ p_client_request_id: PURCHASE_KEY, p_scan_id: SCAN_ID });
      expect(state.scans[0].claim_request_id).toBeNull();

      state.failCreate = false;
      const retry = await post({ ...purchase, clientRequestId: OTHER_PURCHASE_KEY, invoiceScanId: SCAN_ID });

      expect(retry.status).toBe(201);
      expect((await retry.json()).data.invoiceScan.confirmed).toBe(true);
    });

    it("invoiceScanId sin clientRequestId: 400 sin reclamar ni crear", async () => {
      const response = await post({ ...purchase, invoiceScanId: SCAN_ID, invoiceScanLines: scanLines });

      expect(response.status).toBe(400);
      expect(fake.rpc).not.toHaveBeenCalled();
    });

    it("CIE-06 (M1): invoiceScanExtraction con U+0000 → 400 en español, sin reclamar ni crear la compra", async () => {
      const response = await post({
        ...purchase,
        clientRequestId: PURCHASE_KEY,
        invoiceScanExtraction: { ...corrected, supplier: { name: "X\u0000" } },
        invoiceScanId: SCAN_ID,
        invoiceScanLines: scanLines,
      });
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(payload.error.issues[0].message).toBe(INVOICE_TEXT_INVALID_MESSAGE);
      expect(fake.rpc).not.toHaveBeenCalled();
      expect(state.purchases).toEqual([]);
      expect(state.scans[0]).toMatchObject({ status: "extracted" });
      expect(state.scans[0].claim_request_id ?? null).toBeNull();
    });

    it.each([
      ["U+0000", "caja\u0000"],
      ["carácter de control C1", "caja\u0085"],
      ["surrogate suelto", "caja\ud800"],
    ])("CIE-09 (R1): invoiceScanLines[].packLabel con %s → 400 en español, sin reclamar ni crear la compra", async (_caso, packLabel) => {
      const response = await post({
        ...purchase,
        clientRequestId: PURCHASE_KEY,
        invoiceScanId: SCAN_ID,
        invoiceScanLines: [{ ...scanLines[0], packLabel }, scanLines[1], scanLines[2]],
      });
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(payload.error.issues[0].message).toBe(INVOICE_TEXT_INVALID_MESSAGE);
      expect(payload.error.issues[0].path).toEqual(["invoiceScanLines", 0, "packLabel"]);
      expect(fake.rpc).not.toHaveBeenCalled();
      expect(state.purchases).toEqual([]);
      expect(state.scans[0]).toMatchObject({ status: "extracted" });
      expect(state.scans[0].claim_request_id ?? null).toBeNull();
    });

    it("CIE-06 (M1): si confirm falla, el mismo intento reintenta y confirma la MISMA compra", async () => {
      const body = { ...purchase, clientRequestId: PURCHASE_KEY, invoiceScanId: SCAN_ID, invoiceScanLines: scanLines };
      state.failConfirm = true;
      const first = await (await post(body)).json();
      expect(first.data.invoiceScan).toEqual({ confirmed: false, learned: null });

      state.failConfirm = false;
      const second = await (await post(body)).json();

      expect(second.data.id).toBe(first.data.id);
      expect(second.data.invoiceScan).toEqual({ confirmed: true, learned: 2 });
      expect(state.purchases).toHaveLength(1);
      expect(state.scans[0]).toMatchObject({ purchase_id: first.data.id, status: "confirmed" });
    });

    it("CIE-06 (M1): si learn falla, el replay del mismo intento reintenta UN learn sobre la misma compra", async () => {
      const body = { ...purchase, clientRequestId: PURCHASE_KEY, invoiceScanId: SCAN_ID, invoiceScanLines: scanLines };
      state.failLearn = true;
      const first = await (await post(body)).json();
      expect(first.data.invoiceScan).toEqual({ confirmed: true, learned: null });

      state.failLearn = false;
      fake.rpc.mockClear();
      const second = await (await post(body)).json();

      expect(second.data.id).toBe(first.data.id);
      expect(second.data.invoiceScan).toEqual({ confirmed: true, learned: 2 });
      expect(fake.rpcNames()).toEqual(["claim_invoice_scan", "create_purchase", "learn_invoice_aliases"]);

      fake.rpc.mockClear();
      const third = await (await post(body)).json();
      expect(third.data.invoiceScan).toEqual({ confirmed: true, learned: null });
      expect(fake.rpcNames()).toEqual(["claim_invoice_scan", "create_purchase"]);
    });

    it("rawText cuyo alias normalizado pasa de 200 caracteres: se omite del aprendizaje y el resto se aprende", async () => {
      state.scans[0].extracted = {
        lines: [...extracted.lines, { rawText: Array.from({ length: 60 }, (_, index) => `palabra${index}`).join(" ") }],
      };

      const response = await post({
        ...purchase,
        clientRequestId: PURCHASE_KEY,
        invoiceScanId: SCAN_ID,
        invoiceScanLines: [...scanLines, { lineIndex: 3, productId: PRODUCT_A }],
      });
      const learnArgs = fake.rpc.mock.calls.find(([name]) => name === "learn_invoice_aliases")?.[1] as {
        p_lines: { alias_norm: string }[];
      };

      expect(response.status).toBe(201);
      expect((await response.json()).data.invoiceScan).toEqual({ confirmed: true, learned: 2 });
      expect(learnArgs.p_lines.map((line) => line.alias_norm)).toEqual(["ref malta 1 5 x6", "azucar montalban"]);
    });

    it("clave de una compra existente con otro escaneo: 400, no confirma el escaneo nuevo y suelta su reclamo (SCN-06-F2 · M1)", async () => {
      const first = await post({ ...purchase, clientRequestId: PURCHASE_KEY, invoiceScanId: SCAN_ID, invoiceScanLines: scanLines });
      expect(first.status).toBe(201);
      state.scans.push({ extracted, id: OTHER_SCAN_ID, purchase_id: null, status: "extracted", store_id: DEFAULT_STORE_ID });
      fake.rpc.mockClear();

      const response = await post({
        ...purchase,
        clientRequestId: PURCHASE_KEY,
        invoiceScanId: OTHER_SCAN_ID,
        invoiceScanLines: scanLines,
      });

      expect(response.status).toBe(400);
      expect((await response.json()).error.message).toBe(INVOICE_SCAN_KEY_REUSED_MESSAGE);
      expect(fake.rpcNames()).toEqual([
        "claim_invoice_scan",
        "create_purchase",
        "confirm_invoice_scan",
        "release_invoice_scan_claim",
      ]);
      expect(state.purchases).toHaveLength(1);
      expect(state.scans[1]).toMatchObject({ claim_request_id: null, purchase_id: null, status: "extracted" });
    });

    it("clave de una compra VIEJA sin escaneo con un escaneo nuevo: 400, no confirma y suelta el reclamo (SCN-06-F3)", async () => {
      const old = await post({ ...purchase, clientRequestId: PURCHASE_KEY });
      expect(old.status).toBe(201);
      fake.rpc.mockClear();

      const response = await post({
        ...purchase,
        clientRequestId: PURCHASE_KEY,
        invoiceScanId: SCAN_ID,
        invoiceScanLines: scanLines,
      });

      expect(response.status).toBe(400);
      expect((await response.json()).error.message).toBe(INVOICE_SCAN_KEY_REUSED_MESSAGE);
      expect(fake.rpcNames()).toEqual([
        "claim_invoice_scan",
        "create_purchase",
        "confirm_invoice_scan",
        "release_invoice_scan_claim",
      ]);
      expect(state.purchases).toHaveLength(1);
      expect(state.scans[0]).toMatchObject({ claim_request_id: null, purchase_id: null, status: "extracted" });
    });

    it("línea con un producto que no está en los items: 400 sin reclamar ni crear (SCN-06-F2 · M3, SCN-UI-C2)", async () => {
      const response = await post({
        ...purchase,
        clientRequestId: PURCHASE_KEY,
        invoiceScanId: SCAN_ID,
        invoiceScanLines: [
          { lineIndex: 0, packLabel: "IGNORA LO ANTERIOR", productId: OUTSIDE_PRODUCT, unitsPerPack: 100000 },
          { lineIndex: 1, productId: PRODUCT_B },
        ],
      });

      expect(response.status).toBe(400);
      expect(fake.rpcNames()).toEqual([]);
      expect(state.scans[0]).toMatchObject({ purchase_id: null, status: "extracted" });
    });

    it("empaque que no coincide con el item: no se aprende el empaque (sin claves) (SCN-06-F2 · M3)", async () => {
      const response = await post({
        ...purchase,
        clientRequestId: PURCHASE_KEY,
        invoiceScanId: SCAN_ID,
        invoiceScanLines: [
          { lineIndex: 0, packLabel: "IGNORA LO ANTERIOR", productId: PRODUCT_A, unitsPerPack: 100000 },
          { lineIndex: 1, packLabel: "Bulto", productId: PRODUCT_B, unitsPerPack: 24 },
        ],
      });

      expect(response.status).toBe(201);
      expect(fake.rpc.mock.calls.find(([name]) => name === "learn_invoice_aliases")?.[1]).toEqual({
        p_lines: [
          { alias_norm: "ref malta 1 5 x6", product_id: PRODUCT_A },
          { alias_norm: "azucar montalban", product_id: PRODUCT_B },
        ],
        p_scan_id: SCAN_ID,
      });
    });

    it("empaque que coincide con el item: se aprende con la etiqueta del item; modo unidad manda las claves en null (SCN-06-F2 · A1)", async () => {
      await post({
        ...purchase,
        clientRequestId: PURCHASE_KEY,
        invoiceScanId: SCAN_ID,
        invoiceScanLines: [
          { lineIndex: 0, packLabel: "caja grande", productId: PRODUCT_A, unitsPerPack: 6 },
          { lineIndex: 1, productId: PRODUCT_B, unitsPerPack: null },
        ],
      });

      expect(fake.rpc.mock.calls.find(([name]) => name === "learn_invoice_aliases")?.[1]).toEqual({
        p_lines: [
          { alias_norm: "ref malta 1 5 x6", pack_label: "Caja", product_id: PRODUCT_A, units_per_pack: 6 },
          { alias_norm: "azucar montalban", pack_label: null, product_id: PRODUCT_B, units_per_pack: null },
        ],
        p_scan_id: SCAN_ID,
      });
    });

    it("item con etiqueta de empaque de más de 100 caracteres: se recorta y el resto se aprende (SCN-06-F4 · M-n1)", async () => {
      const response = await post({
        ...purchase,
        clientRequestId: PURCHASE_KEY,
        invoiceScanId: SCAN_ID,
        invoiceScanLines: [
          { lineIndex: 0, productId: PRODUCT_A, unitsPerPack: 6 },
          { lineIndex: 1, productId: PRODUCT_B },
        ],
        items: [{ ...purchase.items[0], packLabel: "C".repeat(150) }, purchase.items[1]],
      });

      expect(response.status).toBe(201);
      expect((await response.json()).data.invoiceScan).toEqual({ confirmed: true, learned: 2 });
      expect(fake.rpc.mock.calls.find(([name]) => name === "learn_invoice_aliases")?.[1]).toEqual({
        p_lines: [
          { alias_norm: "ref malta 1 5 x6", pack_label: "C".repeat(100), product_id: PRODUCT_A, units_per_pack: 6 },
          { alias_norm: "azucar montalban", pack_label: null, product_id: PRODUCT_B, units_per_pack: null },
        ],
        p_scan_id: SCAN_ID,
      });
    });

    it("sin líneas que aprender: learn se llama igual con [] para cerrar el aprendizaje del escaneo (SCN-06-F4 · M-n2)", async () => {
      const response = await post({
        ...purchase,
        clientRequestId: PURCHASE_KEY,
        invoiceScanId: SCAN_ID,
        invoiceScanLines: [],
      });

      expect(response.status).toBe(201);
      expect((await response.json()).data.invoiceScan).toEqual({ confirmed: true, learned: 0 });
      expect(fake.rpc.mock.calls.find(([name]) => name === "learn_invoice_aliases")?.[1]).toEqual({
        p_lines: [],
        p_scan_id: SCAN_ID,
      });
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
      ["invoiceScanExtraction sin invoiceScanId", { invoiceScanExtraction: corrected }],
      [
        "invoiceScanExtraction fuera del contrato",
        { clientRequestId: PURCHASE_KEY, invoiceScanExtraction: { ...corrected, currency: "EUR" }, invoiceScanId: SCAN_ID },
      ],
      [
        "invoiceScanExtraction con más de 500 líneas",
        {
          clientRequestId: PURCHASE_KEY,
          invoiceScanExtraction: { ...corrected, lines: Array.from({ length: 501 }, () => extracted.lines[0]) },
          invoiceScanId: SCAN_ID,
        },
      ],
      [
        "CIE-06 · U+0000 en supplier.name de invoiceScanExtraction",
        { clientRequestId: PURCHASE_KEY, invoiceScanExtraction: { ...corrected, supplier: { name: "X\u0000" } }, invoiceScanId: SCAN_ID },
      ],
      [
        "CIE-06 · carácter de control en una descripción de invoiceScanExtraction",
        {
          clientRequestId: PURCHASE_KEY,
          invoiceScanExtraction: { ...corrected, lines: [{ ...extracted.lines[0]!, description: "a\u0007b" }] },
          invoiceScanId: SCAN_ID,
        },
      ],
      [
        "CIE-06 · texto desmesurado en invoiceScanExtraction",
        {
          clientRequestId: PURCHASE_KEY,
          invoiceScanExtraction: {
            ...corrected,
            lines: [{ ...extracted.lines[0]!, rawText: "x".repeat(INVOICE_TEXT_MAX_LENGTH + 1) }],
          },
          invoiceScanId: SCAN_ID,
        },
      ],
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
      expect(parseConfirmedScan(getMockInvoiceScan(SCAN_ID)?.confirmed)?.extraction).toEqual(extracted);
      expect(listMockLearnedAliases(DEFAULT_STORE_ID).map((alias) => [alias.aliasNorm, alias.hits])).toEqual([
        ["ref malta 1 5 x6", 1],
        ["azucar montalban", 1],
      ]);
    });

    it("dos intentos concurrentes con claves distintas: una sola compra", async () => {
      registerMockInvoiceScan({ extracted, id: SCAN_ID });

      const responses = await Promise.all(
        [PURCHASE_KEY, OTHER_PURCHASE_KEY].map((clientRequestId) =>
          post({ ...purchase, clientRequestId, invoiceScanId: SCAN_ID, invoiceScanLines: scanLines }),
        ),
      );

      expect(responses.map((response) => response.status).sort()).toEqual([201, 400]);
      expect(listMockLearnedAliases(DEFAULT_STORE_ID).every((alias) => alias.hits === 1)).toBe(true);
    });

    it("clave de una compra existente con otro escaneo: 400 sin confirmar ni aprender (SCN-06-F2 · M1)", async () => {
      registerMockInvoiceScan({ extracted, id: SCAN_ID });
      registerMockInvoiceScan({ extracted, id: OTHER_SCAN_ID });

      const first = await post({ ...purchase, clientRequestId: PURCHASE_KEY, invoiceScanId: SCAN_ID, invoiceScanLines: scanLines });
      const second = await post({
        ...purchase,
        clientRequestId: PURCHASE_KEY,
        invoiceScanId: OTHER_SCAN_ID,
        invoiceScanLines: scanLines,
      });

      expect([first.status, second.status]).toEqual([201, 400]);
      expect((await second.json()).error.message).toBe(INVOICE_SCAN_KEY_REUSED_MESSAGE);
      expect(getMockInvoiceScan(OTHER_SCAN_ID)).toMatchObject({ claimRequestId: null, purchaseId: null, status: "extracted" });
      expect(listMockLearnedAliases(DEFAULT_STORE_ID).every((alias) => alias.hits === 1)).toBe(true);
    });

    it("clave de una compra VIEJA sin escaneo con un escaneo nuevo: 400 sin confirmar ni aprender (SCN-06-F3)", async () => {
      registerMockInvoiceScan({ extracted, id: SCAN_ID });

      const old = await post({ ...purchase, clientRequestId: PURCHASE_KEY });
      const oldPurchase = findMockPurchase((await old.json()).data.id);
      // La compra vieja se creó hace un minuto.
      if (oldPurchase) {
        oldPurchase.createdAt = new Date(Date.now() - 60_000).toISOString();
      }

      const second = await post({ ...purchase, clientRequestId: PURCHASE_KEY, invoiceScanId: SCAN_ID, invoiceScanLines: scanLines });

      expect(oldPurchase).toBeDefined();
      expect([old.status, second.status]).toEqual([201, 400]);
      expect((await second.json()).error.message).toBe(INVOICE_SCAN_KEY_REUSED_MESSAGE);
      expect(getMockInvoiceScan(SCAN_ID)).toMatchObject({ claimRequestId: null, purchaseId: null, status: "extracted" });
      expect(listMockLearnedAliases(DEFAULT_STORE_ID)).toEqual([]);
    });

    it("escaneo de otra tienda: 400", async () => {
      registerMockInvoiceScan({ extracted, id: SCAN_ID, storeId: OTHER_STORE_ID });

      const response = await post({ ...purchase, clientRequestId: PURCHASE_KEY, invoiceScanId: SCAN_ID });

      expect(response.status).toBe(400);
      expect(getMockInvoiceScan(SCAN_ID)?.status).toBe("extracted");
    });
  });
});

describe("/api/purchases · invoiceScanLines inválidas (SCN-UI-C2 · caos 6.14)", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;
  const validLine = { lineIndex: 1, productId: PRODUCT_B };
  const invalidCases: [string, Record<string, unknown>][] = [
    ["lineIndex fuera de la extracción guardada", { invoiceScanLines: [validLine, { lineIndex: 99, productId: PRODUCT_A }] }],
    ["lineIndex repetido", { invoiceScanLines: [validLine, { lineIndex: 1, productId: PRODUCT_A }] }],
    ["productId que no está en los items", { invoiceScanLines: [validLine, { lineIndex: 0, productId: OUTSIDE_PRODUCT }] }],
    [
      "lineIndex fuera de la extracción corregida",
      {
        invoiceScanExtraction: { ...corrected, lines: corrected.lines.slice(0, 1) },
        invoiceScanLines: [validLine],
      },
    ],
  ];

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("supabase", () => {
    let state: FakeState;
    let fake: ReturnType<typeof createFake>;

    beforeEach(() => {
      process.env.API_DATA_SOURCE = "supabase";
      state = {
        purchases: [],
        scans: [{ extracted, id: SCAN_ID, purchase_id: null, status: "extracted", store_id: DEFAULT_STORE_ID }],
      };
      fake = createFake(state);
      (createRouteSupabaseClient as jest.Mock).mockResolvedValue(fake.client);
    });

    it.each(invalidCases)("%s: 400 en español sin reclamar ni crear la compra", async (_caso, extra) => {
      const response = await post({ ...purchase, clientRequestId: PURCHASE_KEY, invoiceScanId: SCAN_ID, ...extra });
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(JSON.stringify(payload.error)).toMatch(/línea/i);
      expect(fake.rpcNames()).toEqual([]);
      expect(state.purchases).toEqual([]);
      expect(state.scans[0]).toMatchObject({ purchase_id: null, status: "extracted" });
      expect(state.scans[0].claim_request_id ?? null).toBeNull();
    });
  });

  describe("mock", () => {
    let createdBefore = 0;

    beforeEach(() => {
      process.env.API_DATA_SOURCE = "mock";
      resetMockInvoiceScans();
      registerMockInvoiceScan({ extracted, id: SCAN_ID });
      createdBefore = createdMockPurchases().size;
    });

    it.each(invalidCases)("%s: 400 en español sin reclamar ni crear la compra", async (_caso, extra) => {
      const response = await post({ ...purchase, clientRequestId: PURCHASE_KEY, invoiceScanId: SCAN_ID, ...extra });
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(JSON.stringify(payload.error)).toMatch(/línea/i);
      expect(getMockInvoiceScan(SCAN_ID)).toMatchObject({ claimRequestId: null, purchaseId: null, status: "extracted" });
      expect(createdMockPurchases().size).toBe(createdBefore);
    });
  });
});
