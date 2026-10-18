/**
 * @jest-environment node
 */
/**
 * REP2-03c · caos N5 / D25-c: escaneo confirmado en una compra que luego se ANULA
 * (`cancelado`). La factura no queda bloqueada para siempre: el reclamo de otra
 * clave la libera (en la base, `claim_invoice_scan` en el mismo UPDATE
 * condicional) y se puede cargar en una compra nueva. `devuelto` sigue bloqueando.
 */

jest.mock("../../../lib/supabase/route-client", () => ({
  createRouteSupabaseClient: jest.fn(),
}));
jest.mock("../../contacts/services/supplierProducts.server", () => ({
  createSupplierProductPackUnit: jest.fn(),
}));

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { createdMockPurchases } from "@/modules/purchases/services/purchaseMockStore";
import type { PurchaseMock, PurchaseStatus } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import type { InvoiceExtraction } from "../contracts";

import {
  finalizeInvoiceScan,
  getMockInvoiceScan,
  precheckInvoiceScan as precheckMock,
  registerMockInvoiceScan,
  resetMockInvoiceScans,
} from "./confirmScan.mock-server";
import { precheckInvoiceScan as precheckServer } from "./confirmScan.server";

const PRODUCT = "11111111-1111-4111-8111-111111111111";
const SUPPLIER = "33333333-3333-4333-8333-333333333333";
const KEY_1 = "7a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";
const KEY_2 = "9c3d4e5f-6a7b-4c8d-8e9f-0a1b2c3d4e5f";
const PURCHASE_1 = "rep2-03c-purchase-1";
const PURCHASE_2 = "rep2-03c-purchase-2";

const extracted: InvoiceExtraction = {
  confidence: 0.9,
  currency: "VES",
  lines: [{ confidence: 0.9, description: "HARINA PAN", lineTotal: 1, quantity: 1, rawText: "HARINA PAN", unitPrice: 1 }],
  supplier: { name: "Proveedor" },
  warnings: [],
};

function putMockPurchase(id: string, status: PurchaseStatus) {
  const purchase = {
    // Posterior a cualquier reclamo: el mock no la trata como compra vieja de la clave.
    createdAt: "2999-01-01T00:00:00.000Z",
    discountRef: 0,
    id,
    paidVes: 0,
    purchaseNumber: `C-${id}`,
    refRateVes: 900,
    status,
    storeId: DEFAULT_STORE_ID,
    subtotalRef: 1,
    supplierId: SUPPLIER,
    taxRef: 0,
    totalRef: 1,
    totalVes: 900,
    userId: "user-1",
  } satisfies PurchaseMock;

  createdMockPurchases().set(id, { items: [], purchase });
}

async function confirmMock(purchaseId: string, key: string) {
  const scan = await precheckMock({ clientRequestId: key, scanId: "scan-1" }, DEFAULT_STORE_ID);

  return finalizeInvoiceScan(
    scan,
    {
      clientRequestId: key,
      items: [{ entryMode: "unit", productId: PRODUCT }],
      lines: [{ lineIndex: 0, productId: PRODUCT }],
      purchaseId,
      supplierId: SUPPLIER,
    },
    DEFAULT_STORE_ID,
  );
}

describe("REP2-03c · mock: compra ligada anulada libera el escaneo", () => {
  beforeEach(() => {
    resetMockInvoiceScans();
    createdMockPurchases().delete(PURCHASE_1);
    createdMockPurchases().delete(PURCHASE_2);
  });

  it("compra ligada cancelada → otra clave carga la factura en una compra nueva", async () => {
    registerMockInvoiceScan({ extracted, id: "scan-1" });
    putMockPurchase(PURCHASE_1, "pedido");
    await expect(confirmMock(PURCHASE_1, KEY_1)).resolves.toMatchObject({ confirmed: true });

    putMockPurchase(PURCHASE_1, "cancelado");

    await expect(confirmMock(PURCHASE_2, KEY_2)).resolves.toMatchObject({ confirmed: true });
    expect(getMockInvoiceScan("scan-1")).toMatchObject({ purchaseId: PURCHASE_2, status: "confirmed" });
  });

  it.each(["pedido", "devuelto"] as const)("compra ligada %s → sigue bloqueada (400 ya confirmado)", async (status) => {
    registerMockInvoiceScan({ extracted, id: "scan-1" });
    putMockPurchase(PURCHASE_1, "pedido");
    await confirmMock(PURCHASE_1, KEY_1);
    putMockPurchase(PURCHASE_1, status);

    await expect(confirmMock(PURCHASE_2, KEY_2)).rejects.toMatchObject({
      message: "El escaneo ya fue confirmado",
      status: 400,
    });
    expect(getMockInvoiceScan("scan-1")).toMatchObject({ purchaseId: PURCHASE_1, status: "confirmed" });
  });
});

describe("REP2-03c · server: escaneo liberado por el reclamo valida las líneas", () => {
  afterEach(() => jest.restoreAllMocks());

  it("fila leída confirmed + reclamo 'claimed' (compra anulada) y línea fuera de la extracción → 400 y suelta el reclamo", async () => {
    const rpc = jest.fn(async (name: string) => {
      if (name === "claim_invoice_scan") return { data: "claimed", error: null };
      if (name === "release_invoice_scan_claim") return { data: null, error: null };
      throw new Error(`RPC inesperada ${name}`);
    });
    const builder = {
      eq: () => builder,
      maybeSingle: async () => ({
        data: { extracted, id: "scan-1", learned_at: "2026-10-18T00:00:00Z", purchase_id: PURCHASE_1, status: "confirmed" },
        error: null,
      }),
      select: () => builder,
    };
    jest.mocked(createRouteSupabaseClient).mockResolvedValue({ from: () => builder, rpc } as never);

    await expect(
      precheckServer({ clientRequestId: KEY_2, lines: [{ lineIndex: 5, productId: PRODUCT }], scanId: "scan-1" }, DEFAULT_STORE_ID),
    ).rejects.toMatchObject({ status: 400 });
    expect(rpc).toHaveBeenCalledWith("release_invoice_scan_claim", { p_client_request_id: KEY_2, p_scan_id: "scan-1" });
  });
});
