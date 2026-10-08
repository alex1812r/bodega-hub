/**
 * @jest-environment node
 */
/**
 * INV-01a · `listInventory` del mock: misma forma y mismos filtros que la vista
 * `inventory_overview`, calculados desde `mockStockMovements`.
 */

import { mockProducts, mockStockMovements } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { createStockAdjustment, listInventory } from "./inventory.mock-server";

const SUR_STORE_ID = "00000000-0000-4000-8000-000000000002";
/** Los movimientos semilla son del 15 al 18 de mayo de 2026: la ventana empieza el 17 a las 12:00 UTC. */
const NOW = new Date("2026-06-16T12:00:00.000Z");

function list(queryString: string, role?: "admin" | "almacen" | "vendedor" | "contador", storeId = DEFAULT_STORE_ID) {
  return listInventory(new URLSearchParams(`limit=100&${queryString}`), storeId, { role });
}

function item(id: string, role?: "admin" | "almacen") {
  const found = list("", role).items.find((entry) => entry.id === id);

  if (!found) {
    throw new Error(`Falta ${id} en el listado`);
  }

  return found;
}

describe("inventory.mock-server · listInventory (vista única de stock)", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("suma entradas y salidas de los últimos 30 días y da el último movimiento", () => {
    expect(item("prod-cable")).toEqual(
      expect.objectContaining({
        category: expect.objectContaining({ id: "cat-electric" }),
        currentStock: 4,
        entries30d: 10,
        exits30d: 1,
        lastMovementAt: "2026-05-18T15:10:00.000Z",
        lastMovementType: "venta",
        stockStatus: "low",
      }),
    );
  });

  it("un movimiento de hace más de 30 días no suma, pero sigue siendo el último", () => {
    expect(item("prod-hammer")).toEqual(
      expect.objectContaining({
        entries30d: 0,
        exits30d: 0,
        lastMovementAt: "2026-05-17T10:20:00.000Z",
        lastMovementType: "venta",
        stockStatus: "out",
      }),
    );
  });

  it("un producto sin movimientos sale con ceros y sin último movimiento", () => {
    expect(item("prod-paint")).toEqual(
      expect.objectContaining({
        entries30d: 0,
        exits30d: 0,
        lastMovementAt: null,
        lastMovementType: null,
        stockStatus: "ok",
      }),
    );
  });

  it("lista solo productos activos de la tienda", () => {
    const ids = list("").items.map((entry) => entry.id);

    expect(ids).toContain("prod-cable");
    expect(ids).not.toContain("prod-latex");
    expect(ids).not.toContain("prod-sur-arroz");
    expect(list("", undefined, SUR_STORE_ID).items.map((entry) => entry.id)).toEqual(
      expect.arrayContaining(["prod-sur-arroz", "prod-sur-aceite"]),
    );
  });

  it("filtra por productId, categoría, estado de stock, lowStock, precio y búsqueda", () => {
    expect(list("productId=prod-cable").items.map((entry) => entry.id)).toEqual(["prod-cable"]);
    expect(list("productId=no-existe")).toMatchObject({ items: [], total: 0 });
    expect(list("categoryId=cat-electric").items.every((entry) => entry.categoryId === "cat-electric")).toBe(true);
    expect(list("stockStatus=out").items.map((entry) => entry.stockStatus)).toEqual(["out"]);
    expect(list("stockStatus=low,out").items.every((entry) => entry.stockStatus !== "ok")).toBe(true);
    expect(list("lowStock=true").items.every((entry) => entry.stockStatus !== "ok")).toBe(true);
    expect(list("lowStock=true&stockStatus=ok")).toMatchObject({ items: [], total: 0 });
    expect(
      list("minPriceRef=7&maxPriceRef=15").items.every((entry) => entry.salePriceRef >= 7 && entry.salePriceRef <= 15),
    ).toBe(true);
    expect(list("search=cable").items.map((entry) => entry.id)).toContain("prod-cable");
  });

  it("stockStatus de cada fila es el de getInventoryStockStatus", () => {
    for (const entry of list("").items) {
      const expected = entry.currentStock === 0 ? "out" : entry.currentStock <= entry.minStock ? "low" : "ok";

      expect(entry.stockStatus).toBe(expected);
    }
  });

  it("skip más allá del total responde página vacía con el total real", () => {
    const all = list("");
    const beyond = listInventory(new URLSearchParams("skip=500&limit=10"), DEFAULT_STORE_ID);

    expect(beyond).toEqual({ items: [], limit: 10, skip: 500, total: all.total });
  });

  it("paginación y números inválidos no fallan", () => {
    const result = listInventory(
      new URLSearchParams("skip=abc&limit=-5&minPriceRef=caro&maxPriceRef=Infinity&stockStatus=nada"),
      DEFAULT_STORE_ID,
    );

    expect(result).toMatchObject({ limit: 10, skip: 0 });
    expect(result.total).toBe(list("").total);
  });

  describe("descuadre (reconciliationDiff)", () => {
    it("admin: current_stock − Σ movimientos del producto", () => {
      // prod-cable: stock 4, libro +10 −1 = 9.
      expect(item("prod-cable", "admin").reconciliationDiff).toBe(-5);
    });

    it("admin: null cuando el producto cuadra con su libro", () => {
      const paint = mockProducts.find((product) => product.id === "prod-paint");

      mockStockMovements.push({
        createdAt: "2026-01-10T08:00:00.000Z",
        id: "mov-inv01a-paint",
        productId: "prod-paint",
        quantityDelta: paint?.currentStock ?? 0,
        stockAfter: paint?.currentStock ?? 0,
        type: "inventario_inicial",
      });

      try {
        expect(item("prod-paint", "admin")).toEqual(
          expect.objectContaining({ entries30d: 0, lastMovementType: "inventario_inicial", reconciliationDiff: null }),
        );
      } finally {
        mockStockMovements.pop();
      }
    });

    it.each(["almacen", "vendedor", "contador", undefined] as const)("rol %s: el campo no viaja", (role) => {
      expect(list("", role).items.every((entry) => !("reconciliationDiff" in entry))).toBe(true);
    });
  });

  it("un ajuste nuevo entra en las cifras sin que nadie escriba el stock a mano", () => {
    const before = item("prod-pipe");

    createStockAdjustment({ productId: "prod-pipe", quantityDelta: 3 }, DEFAULT_STORE_ID);
    createStockAdjustment({ productId: "prod-pipe", quantityDelta: -2 }, DEFAULT_STORE_ID);

    const after = item("prod-pipe");

    expect(after.currentStock).toBe(before.currentStock + 1);
    expect(after.entries30d).toBe(before.entries30d + 3);
    expect(after.exits30d).toBe(before.exits30d + 2);
    expect(after.lastMovementAt).toBe(NOW.toISOString());
  });
});
