/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../lib/supabase/admin-client");

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { listPreferredSuppliersByProduct, saveProductSuppliers } from "./supplierProducts.server";

const OTHER_STORE_ID = "00000000-0000-4000-8000-000000000002";
const productId = "22222222-2222-4222-8222-222222222222";
const supplierA = "33333333-3333-4333-8333-333333333333";
const supplierB = "44444444-4444-4444-8444-444444444444";

/** `assertSupabaseStoreResource("products", …)` lee la tienda del producto con el cliente admin. */
function productStore(row: { store_id: string } | null) {
  const maybeSingle = jest.fn().mockResolvedValue({ data: row, error: null });
  const from = jest.fn(() => ({ select: jest.fn(() => ({ eq: jest.fn(() => ({ maybeSingle })) })) }));

  (createAdminSupabaseClient as jest.Mock).mockReturnValue({ from });

  return from;
}

function routeClient(handlers: { from?: jest.Mock; rpc?: jest.Mock }) {
  const client = { from: handlers.from ?? jest.fn(), rpc: handlers.rpc ?? jest.fn() };

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue(client);

  return client;
}

describe("supplierProducts.server · saveProductSuppliers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    productStore({ store_id: DEFAULT_STORE_ID });
  });

  it("llama a save_product_suppliers UNA vez con el payload exacto y sin tocar tablas, y mapea la respuesta", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: {
        preferred_auto_assigned: false,
        preferred_changed: true,
        preferred_supplier_id: supplierB,
        previous_preferred_supplier_id: supplierA,
        product_id: productId,
        suppliers: [
          {
            cost_ref: 4.2,
            id: "link-b",
            is_preferred: true,
            last_purchased_at: "2026-10-01T12:00:00+00:00",
            supplier_id: supplierB,
            supplier_is_active: true,
            supplier_name: "Beta",
            supplier_sku: "BET-01",
            updated_at: "2026-10-08T12:00:00+00:00",
          },
          {
            cost_ref: null,
            id: "link-a",
            is_preferred: false,
            last_purchased_at: null,
            supplier_id: supplierA,
            supplier_is_active: false,
            supplier_name: "Alfa",
            supplier_sku: null,
            updated_at: null,
          },
        ],
      },
      error: null,
    });
    const client = routeClient({ rpc });

    const result = await saveProductSuppliers(
      productId,
      [
        { isPreferred: false, supplierId: supplierA },
        { costRef: 4.2, isPreferred: true, supplierId: supplierB, supplierSku: "bet-01" },
        { costRef: 0, isPreferred: false, supplierId: "sup-c", supplierSku: null },
      ],
      DEFAULT_STORE_ID,
    );

    expect(rpc.mock.calls).toEqual([
      [
        "save_product_suppliers",
        {
          p_product_id: productId,
          p_suppliers: [
            { is_preferred: false, supplier_id: supplierA },
            { cost_ref: 4.2, is_preferred: true, supplier_id: supplierB, supplier_sku: "bet-01" },
            { cost_ref: 0, is_preferred: false, supplier_id: "sup-c", supplier_sku: null },
          ],
        },
      ],
    ]);
    expect(client.from).not.toHaveBeenCalled();
    expect(result).toEqual({
      preferredAutoAssigned: false,
      preferredChanged: true,
      preferredSupplierId: supplierB,
      previousPreferredSupplierId: supplierA,
      suppliers: [
        {
          costRef: 4.2,
          id: "link-b",
          isPreferred: true,
          lastPurchasedAt: "2026-10-01T12:00:00+00:00",
          supplierId: supplierB,
          supplierIsActive: true,
          supplierName: "Beta",
          supplierSku: "bet-01",
          updatedAt: "2026-10-08T12:00:00+00:00",
        },
        {
          costRef: 0,
          id: "link-a",
          isPreferred: false,
          supplierId: supplierA,
          supplierIsActive: false,
          supplierName: "Alfa",
        },
      ],
    });
  });

  it("la lista vacía viaja como arreglo vacío y un producto sin habitual responde null", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: {
        preferred_auto_assigned: true,
        preferred_changed: true,
        preferred_supplier_id: null,
        previous_preferred_supplier_id: supplierA,
        suppliers: [],
      },
      error: null,
    });
    routeClient({ rpc });

    const result = await saveProductSuppliers(productId, [], DEFAULT_STORE_ID);

    expect(rpc).toHaveBeenCalledWith("save_product_suppliers", { p_product_id: productId, p_suppliers: [] });
    expect(result).toEqual({
      preferredAutoAssigned: true,
      preferredChanged: true,
      preferredSupplierId: null,
      previousPreferredSupplierId: supplierA,
      suppliers: [],
    });
  });

  it.each([
    ["PT400", 400, "BAD_REQUEST", "El proveedor Alfa está inactivo: no se puede vincular al producto"],
    ["PT403", 403, "FORBIDDEN", "No autorizado para gestionar los proveedores del producto"],
    ["PT404", 404, "NOT_FOUND", "Producto no encontrado"],
  ])("el rechazo %s de la RPC responde %i con su mensaje", async (sqlState, status, code, message) => {
    routeClient({ rpc: jest.fn().mockResolvedValue({ data: null, error: { code: sqlState, message } }) });

    await expect(
      saveProductSuppliers(productId, [{ isPreferred: true, supplierId: supplierA }], DEFAULT_STORE_ID),
    ).rejects.toMatchObject({ code, message, status });
  });

  it("producto de otra tienda responde 403 y uno inexistente 404, sin llamar a la RPC", async () => {
    const rpc = jest.fn();
    routeClient({ rpc });

    productStore({ store_id: OTHER_STORE_ID });
    await expect(saveProductSuppliers(productId, [], DEFAULT_STORE_ID)).rejects.toMatchObject({ status: 403 });

    productStore(null);
    await expect(saveProductSuppliers(productId, [], DEFAULT_STORE_ID)).rejects.toMatchObject({
      message: "Producto no encontrado.",
      status: 404,
    });

    expect(rpc).not.toHaveBeenCalled();
  });

  it("una respuesta vacía de la RPC es un 500, no un guardado silencioso", async () => {
    routeClient({ rpc: jest.fn().mockResolvedValue({ data: null, error: null }) });

    await expect(saveProductSuppliers(productId, [], DEFAULT_STORE_ID)).rejects.toMatchObject({ status: 500 });
  });
});

describe("supplierProducts.server · listPreferredSuppliersByProduct", () => {
  function preferredQuery(result: { data: unknown; error: unknown }) {
    const chain = {
      eq: jest.fn(),
      in: jest.fn().mockResolvedValue(result),
      select: jest.fn(),
    };
    chain.eq.mockReturnValue(chain);
    chain.select.mockReturnValue(chain);
    const from = jest.fn(() => chain);

    routeClient({ from });

    return { chain, from };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("trae el habitual de toda la página en UNA consulta acotada a la tienda", async () => {
    const { chain, from } = preferredQuery({
      data: [
        { product_id: "p1", supplier: { id: supplierA, name: "Alfa" } },
        { product_id: "p2", supplier: [{ id: supplierB, name: "Beta" }] },
        { product_id: "p3", supplier: null },
      ],
      error: null,
    });

    const preferred = await listPreferredSuppliersByProduct(["p1", "p2", "p3", "p4"], DEFAULT_STORE_ID);

    expect(from.mock.calls).toEqual([["supplier_products"]]);
    expect(chain.select).toHaveBeenCalledWith("product_id, supplier:contacts(id, name)");
    expect(chain.eq.mock.calls).toEqual([
      ["store_id", DEFAULT_STORE_ID],
      ["is_preferred", true],
    ]);
    expect(chain.in).toHaveBeenCalledWith("product_id", ["p1", "p2", "p3", "p4"]);
    expect([...preferred]).toEqual([
      ["p1", { id: supplierA, name: "Alfa" }],
      ["p2", { id: supplierB, name: "Beta" }],
    ]);
  });

  it("sin productos no consulta nada", async () => {
    const { from } = preferredQuery({ data: [], error: null });

    expect([...(await listPreferredSuppliersByProduct([], DEFAULT_STORE_ID))]).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it("si la base aún no tiene la columna (parche sin aplicar) responde vacío en vez de romper el listado", async () => {
    preferredQuery({
      data: null,
      error: { code: "42703", message: "column supplier_products.is_preferred does not exist" },
    });

    expect([...(await listPreferredSuppliersByProduct(["p1"], DEFAULT_STORE_ID))]).toEqual([]);
  });

  it("cualquier otro error de la consulta se propaga", async () => {
    preferredQuery({ data: null, error: { code: "42501", message: "permission denied" } });

    await expect(listPreferredSuppliersByProduct(["p1"], DEFAULT_STORE_ID)).rejects.toMatchObject({ status: 403 });
  });
});
