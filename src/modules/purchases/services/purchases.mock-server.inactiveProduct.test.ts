/**
 * @jest-environment node
 */
/**
 * COM-15 · una compra (recibida o en pedido) no admite líneas de un producto
 * inactivo, con la regla y el texto de `create_purchase` (parche 20261010b): 400
 * nombrando el producto y nada creado. Recibir un pedido hecho antes de desactivar
 * el producto se permite. Cubre el mock, `POST /api/purchases` y el mapeo del
 * PT400 de la base en `purchases.server`.
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../lib/supabase/admin-client");

import { POST } from "@/app/api/purchases/route";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { listProductSuppliers } from "@/modules/contacts/services/supplierProducts.mock-server";
import { createProduct, deleteProduct } from "@/modules/products/services/products.mock-server";
import { mockProducts } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import type { PurchaseItemInput } from "../schemas/purchaseItem.schema";
import {
  createPurchase,
  getPurchaseById,
  listPurchases,
  receivePurchase,
  type PurchaseInput,
} from "./purchases.mock-server";
import { createPurchase as createPurchaseOnDatabase } from "./purchases.server";

const SUPPLIER = "cont-supplier";
const RATE = 510;
const REQUEST_ID = "6f1a2b3c-4d5e-4f60-8a71-92b3c4d5e6f7";

let seq = 0;

function newProduct(name: string, options: { inactive?: boolean } = {}) {
  seq += 1;

  const { id } = createProduct(
    { currentCostRef: 1, name, salePriceRef: 10, sku: `inactivo-${seq}` },
    DEFAULT_STORE_ID,
  );

  if (options.inactive) {
    deleteProduct(id, DEFAULT_STORE_ID);
  }

  return id;
}

function unitLine(productId: string, unitCostRef = 5): PurchaseItemInput {
  return {
    costCurrency: "ref",
    entryMode: "unit",
    productId,
    quantity: 1,
    subtotalRef: unitCostRef,
    subtotalVes: unitCostRef * RATE,
    taxRateCode: "exento",
    taxRef: 0,
    taxVes: 0,
    unitCostRef,
    unitCostVes: unitCostRef * RATE,
  };
}

function purchaseInput(items: PurchaseItemInput[], extra: Partial<PurchaseInput> = {}): PurchaseInput {
  const subtotalRef = items.reduce((total, item) => total + item.subtotalRef, 0);

  return {
    discountRef: 0,
    discountVes: 0,
    items,
    refRateVes: RATE,
    subtotalRef,
    subtotalVes: subtotalRef * RATE,
    supplierId: SUPPLIER,
    taxRef: 0,
    taxVes: 0,
    ...extra,
  };
}

function buy(items: PurchaseItemInput[], extra: Partial<PurchaseInput> = {}) {
  return createPurchase(purchaseInput(items, extra), DEFAULT_STORE_ID);
}

function purchaseCount() {
  return listPurchases(new URLSearchParams({ limit: "1" }), DEFAULT_STORE_ID).total;
}

function linkCount(productId: string) {
  return listProductSuppliers(productId, new URLSearchParams({ limit: "100" }), DEFAULT_STORE_ID).total;
}

function costOf(productId: string) {
  return mockProducts.find((product) => product.id === productId)?.currentCostRef;
}

describe("purchases.mock-server · producto inactivo (COM-15)", () => {
  it.each(["recibido", "pedido"] as const)(
    "compra %s de un producto inactivo: 400 nombrando el producto y nada creado (ni compra, ni vínculo, ni costo)",
    (status) => {
      const productId = newProduct("Harina inactiva", { inactive: true });
      const before = purchaseCount();

      expect(() => buy([unitLine(productId)], { status })).toThrow(
        expect.objectContaining({
          code: "BAD_REQUEST",
          message: "El producto Harina inactiva está inactivo: no se puede registrar la compra",
          status: 400,
        }),
      );
      expect({ compras: purchaseCount(), costo: costOf(productId), vinculos: linkCount(productId) }).toEqual({
        compras: before,
        costo: 1,
        vinculos: 0,
      });
    },
  );

  it("una línea inactiva entre líneas activas rechaza la compra entera: las activas no quedan vinculadas ni cambian de costo", () => {
    const active = newProduct("Arroz activo");
    const inactive = newProduct("Arroz inactivo", { inactive: true });
    const before = purchaseCount();

    expect(() => buy([unitLine(active), unitLine(inactive)])).toThrow(
      "El producto Arroz inactivo está inactivo: no se puede registrar la compra",
    );
    expect({ compras: purchaseCount(), costo: costOf(active), vinculos: linkCount(active) }).toEqual({
      compras: before,
      costo: 1,
      vinculos: 0,
    });
  });

  it("varios productos inactivos: el mensaje los nombra a todos, en orden alfabético y sin repetir", () => {
    const second = newProduct("Zumo inactivo", { inactive: true });
    const first = newProduct("Avena inactiva", { inactive: true });

    expect(() => buy([unitLine(second), unitLine(first), unitLine(second)])).toThrow(
      expect.objectContaining({
        message: "Los productos Avena inactiva, Zumo inactivo están inactivos: no se puede registrar la compra",
        status: 400,
      }),
    );
  });

  it("pedido hecho con el producto activo que se desactiva después: se puede recibir y fija el costo de la línea", () => {
    const productId = newProduct("Café en camino");
    const ordered = buy([unitLine(productId, 7)], { status: "pedido" });
    deleteProduct(productId, DEFAULT_STORE_ID);

    const received = receivePurchase(ordered.id, DEFAULT_STORE_ID);

    expect({ costo: costOf(productId), estado: received.status }).toEqual({ costo: 7, estado: "recibido" });
    expect(() => buy([unitLine(productId, 7)], { status: "pedido" })).toThrow(
      "El producto Café en camino está inactivo: no se puede registrar la compra",
    );
  });

  it("el detalle de la compra expone si el producto de cada línea está activo (product.isActive)", () => {
    const productId = newProduct("Té en camino");
    const ordered = buy([unitLine(productId)], { status: "pedido" });
    deleteProduct(productId, DEFAULT_STORE_ID);

    expect(getPurchaseById(ordered.id, DEFAULT_STORE_ID).items.map((item) => item.product?.isActive)).toEqual([false]);
  });

  it("reintento con el mismo clientRequestId de una compra hecha antes de desactivar el producto: devuelve la compra original", () => {
    const productId = newProduct("Sal reintentada");
    const first = buy([unitLine(productId)], { clientRequestId: REQUEST_ID });
    deleteProduct(productId, DEFAULT_STORE_ID);

    expect(buy([unitLine(productId)], { clientRequestId: REQUEST_ID })).toBe(first);
  });

  it("producto activo: la compra se crea como siempre", () => {
    const productId = newProduct("Azúcar activa");

    const purchase = buy([unitLine(productId, 3)]);

    expect({ costo: costOf(productId), estado: purchase.status, vinculos: linkCount(productId) }).toEqual({
      costo: 3,
      estado: "recibido",
      vinculos: 1,
    });
  });
});

describe("POST /api/purchases · producto inactivo (COM-15)", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  function post(body: unknown) {
    return POST(
      new Request("http://localhost/api/purchases", {
        body: JSON.stringify(body),
        headers: { "content-type": "application/json", "x-demo-role": "almacen" },
        method: "POST",
      }),
    );
  }

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it.each(["recibido", "pedido"] as const)("compra %s: responde 400 con el mensaje en español", async (status) => {
    const productId = newProduct("Leche inactiva", { inactive: true });

    const response = await post(purchaseInput([unitLine(productId)], { status }));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toEqual({
      code: "BAD_REQUEST",
      message: "El producto Leche inactiva está inactivo: no se puede registrar la compra",
    });
  });
});

describe("purchases.server · producto inactivo (COM-15)", () => {
  it("el PT400 de create_purchase llega como 400 con el mensaje de la base, tal cual", async () => {
    const message = "El producto Harina PAN está inactivo: no se puede registrar la compra";
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { code: "PT400", message } });
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ rpc });

    await expect(
      createPurchaseOnDatabase(
        {
          ...purchaseInput([unitLine("44444444-4444-4444-4444-444444444444")]),
          clientRequestId: REQUEST_ID,
          supplierId: "22222222-2222-2222-2222-222222222222",
        },
        DEFAULT_STORE_ID,
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message, status: 400 });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
