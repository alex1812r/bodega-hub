/**
 * @jest-environment node
 */
/**
 * SCN-08-F2 · 6.8: confirmar una compra escaneada con un empaque nuevo para un
 * vínculo proveedor-producto que YA existía deja registrado ese empaque del
 * proveedor (`create_purchase` solo lo crea con vínculo nuevo, 20261010d).
 * Idempotente, y un rechazo de la receta no rompe la compra.
 */

jest.mock("../../../lib/supabase/route-client", () => ({
  createRouteSupabaseClient: jest.fn(),
}));
jest.mock("../../contacts/services/supplierProducts.server", () => ({
  createSupplierProductPackUnit: jest.fn(),
}));

import { ApiError } from "@/lib/api/apiError";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { createSupplierProductPackUnit } from "@/modules/contacts/services/supplierProducts.server";
import { listSupplierProductPackUnits } from "@/modules/contacts/services/supplierProducts.mock-server";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import type { InvoiceExtraction } from "../contracts";

import * as mockService from "./confirmScan.mock-server";
import { finalizeInvoiceScan, type FinalizeInvoiceScanInput, type PrecheckedInvoiceScan } from "./confirmScan.server";
import { loadMockMatchContext } from "./matchContext.mock-server";

const PRODUCT = "11111111-1111-4111-8111-111111111111";
const SUPPLIER = "33333333-3333-4333-8333-333333333333";
const PURCHASE = "00000000-0000-4000-8000-000000000101";
const KEY = "7a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";

const extraction: InvoiceExtraction = {
  confidence: 0.9,
  currency: "VES",
  lines: [{ confidence: 0.9, description: "HARINA PAN CAJA X20", lineTotal: 2400, quantity: 1, rawText: "HARINA PAN CAJA X20", unitPrice: 2400 }],
  supplier: { name: "Proveedor" },
  warnings: [],
};

const scan: PrecheckedInvoiceScan = {
  extraction,
  id: "scan-1",
  purchaseId: null,
  rawTexts: ["HARINA PAN CAJA X20"],
  replay: false,
};

function input(productId = PRODUCT, supplierId = SUPPLIER, purchaseId = PURCHASE): FinalizeInvoiceScanInput {
  return {
    clientRequestId: KEY,
    items: [{ entryMode: "pack", packLabel: "Caja", productId, unitsPerPack: 20 }],
    lines: [{ lineIndex: 0, packLabel: "Caja", productId, unitsPerPack: 20 }],
    purchaseId,
    supplierId,
  };
}

type Pack = { units_per_pack: number; is_active: boolean; is_default: boolean };

function fakeClient(link: { id: string; supplier_product_pack_units: Pack[] } | null) {
  const filters: Record<string, unknown>[] = [];
  const builder = {
    eq(column: string, value: unknown) {
      filters[filters.length - 1][column] = value;
      return builder;
    },
    async maybeSingle() {
      return { data: link, error: null };
    },
    select() {
      return builder;
    },
  };
  return {
    filters,
    client: {
      from: jest.fn(() => {
        filters.push({});
        return builder;
      }),
      rpc: jest.fn(async (name: string) => {
        if (name === "confirm_invoice_scan") return { data: true, error: null };
        if (name === "learn_invoice_aliases") return { data: 1, error: null };
        throw new Error(`RPC inesperada ${name}`);
      }),
    },
  };
}

describe("finalizeInvoiceScan · empaque del proveedor (SCN-08-F2 · 6.8)", () => {
  beforeEach(() => {
    jest.mocked(createSupplierProductPackUnit).mockReset();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it("vínculo existente con Caja x12 y línea Caja x20: crea el empaque x20 con la etiqueta del item", async () => {
    const fake = fakeClient({ id: "sp-1", supplier_product_pack_units: [{ units_per_pack: 12, is_active: true, is_default: true }] });
    jest.mocked(createRouteSupabaseClient).mockResolvedValue(fake.client as never);

    await expect(finalizeInvoiceScan(scan, input(), DEFAULT_STORE_ID)).resolves.toEqual({ confirmed: true, learned: 1 });

    expect(createSupplierProductPackUnit).toHaveBeenCalledTimes(1);
    expect(createSupplierProductPackUnit).toHaveBeenCalledWith(
      "sp-1",
      { isDefault: false, label: "Caja", unitsPerPack: 20 },
      DEFAULT_STORE_ID,
    );
    expect(fake.filters[0]).toMatchObject({ store_id: DEFAULT_STORE_ID, supplier_id: SUPPLIER, product_id: PRODUCT });
  });

  it("vínculo sin empaques: el creado queda predeterminado", async () => {
    jest.mocked(createRouteSupabaseClient).mockResolvedValue(fakeClient({ id: "sp-1", supplier_product_pack_units: [] }).client as never);

    await finalizeInvoiceScan(scan, input(), DEFAULT_STORE_ID);

    expect(createSupplierProductPackUnit).toHaveBeenCalledWith("sp-1", expect.objectContaining({ isDefault: true }), DEFAULT_STORE_ID);
  });

  it("ya hay un empaque activo de ese tamaño: no crea otro (idempotente)", async () => {
    const fake = fakeClient({ id: "sp-1", supplier_product_pack_units: [{ units_per_pack: 20, is_active: true, is_default: false }] });
    jest.mocked(createRouteSupabaseClient).mockResolvedValue(fake.client as never);

    await finalizeInvoiceScan(scan, input(), DEFAULT_STORE_ID);

    expect(createSupplierProductPackUnit).not.toHaveBeenCalled();
  });

  it("replay del mismo intento: no toca empaques", async () => {
    await finalizeInvoiceScan({ ...scan, purchaseId: PURCHASE, replay: true }, input(), DEFAULT_STORE_ID);

    expect(createSupplierProductPackUnit).not.toHaveBeenCalled();
  });

  it("la receta rechaza el tamaño: se registra el error, la compra sigue confirmada y se aprende", async () => {
    const fake = fakeClient({ id: "sp-1", supplier_product_pack_units: [] });
    jest.mocked(createRouteSupabaseClient).mockResolvedValue(fake.client as never);
    jest.mocked(createSupplierProductPackUnit).mockRejectedValue(new ApiError(400, "BAD_REQUEST", "no coincide con la receta"));

    await expect(finalizeInvoiceScan(scan, input(), DEFAULT_STORE_ID)).resolves.toEqual({ confirmed: true, learned: 1 });

    expect(console.error).toHaveBeenCalledWith(
      "[invoice-scan] pack falló; la compra quedó creada",
      expect.objectContaining({ scanId: "scan-1", message: "no coincide con la receta" }),
    );
    expect(fake.client.rpc).toHaveBeenCalledWith("learn_invoice_aliases", expect.anything());
  });
});

describe("finalizeInvoiceScan mock · empaque del proveedor (paridad)", () => {
  // Vínculo semilla supp-prod-cable: cont-supplier -> prod-cable con Bulto x12.
  const MOCK_SUPPLIER = "cont-supplier";
  const MOCK_PRODUCT = "prod-cable";
  const MOCK_LINK = "supp-prod-cable";

  beforeEach(() => mockService.resetMockInvoiceScans());

  async function confirmMock(scanId: string, key: string, purchaseId: string) {
    mockService.registerMockInvoiceScan({ extracted: extraction, id: scanId });
    const prechecked = await mockService.precheckInvoiceScan({ clientRequestId: key, scanId }, DEFAULT_STORE_ID);
    return mockService.finalizeInvoiceScan(
      prechecked,
      { ...input(MOCK_PRODUCT, MOCK_SUPPLIER, purchaseId), clientRequestId: key },
      DEFAULT_STORE_ID,
    );
  }

  const sizes = () =>
    listSupplierProductPackUnits(MOCK_LINK, DEFAULT_STORE_ID)
      .filter((pack) => pack.isActive)
      .map((pack) => `${pack.label}/${pack.unitsPerPack}`)
      .sort();

  it("crea el empaque que falta una sola vez y el contexto de emparejamiento lo ve", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    expect(sizes()).toEqual(["Bulto/12"]);

    await expect(confirmMock("scan-m1", KEY, "purchase-m1")).resolves.toMatchObject({ confirmed: true });
    expect(sizes()).toEqual(["Bulto/12", "Caja/20"]);

    // Otro escaneo con el mismo tamaño: no duplica.
    await confirmMock("scan-m2", "9c3d4e5f-6a7b-4c8d-8e9f-0a1b2c3d4e5f", "purchase-m2");
    expect(sizes()).toEqual(["Bulto/12", "Caja/20"]);

    const ctx = loadMockMatchContext(DEFAULT_STORE_ID, { ...extraction, supplier: { name: "Suministros Industriales CA", taxId: "J-00000002-2" } });
    const packs = ctx.supplierCatalogs[MOCK_SUPPLIER].packUnits.filter((pack) => pack.productId === MOCK_PRODUCT);
    expect(packs.map((pack) => pack.unitsPerPack).sort((a, b) => a - b)).toEqual([12, 20]);
  });
});
