/**
 * @jest-environment node
 */
/**
 * INV-04a · paridad del mock con `listStockMovements` / `getStockCard` de
 * Supabase: mismos filtros, validaciones, documento resuelto y orden.
 */

import { ApiError } from "@/lib/api/apiError";
import {
  mockPurchases,
  mockSales,
  mockStockMovements,
  type StockMovementMock,
} from "@/shared/mocks/erp-data";

import { getStockCard, listStockMovements } from "./inventory.mock-server";

/** Tienda propia del test: nada de los datos de demostración entra en las cuentas. */
const STORE_ID = "store-inv-04a";
const OTHER_STORE_ID = "store-inv-04a-otra";

function movement(
  input: Pick<StockMovementMock, "createdAt" | "id" | "type"> & Partial<StockMovementMock>,
): StockMovementMock {
  return { productId: "prod-cable", quantityDelta: 1, stockAfter: 1, storeId: STORE_ID, ...input };
}

beforeAll(() => {
  mockSales.push(
    { ...mockSales[0], id: "sale-inv04-a", invoiceNumber: "V-770001", storeId: STORE_ID },
    { ...mockSales[0], id: "sale-inv04-b", invoiceNumber: "V-77(0),2%", storeId: STORE_ID },
  );
  mockPurchases.push({
    ...mockPurchases[0],
    id: "purchase-inv04-a",
    purchaseNumber: "C-880001",
    storeId: STORE_ID,
  });

  // Desordenados a propósito; los dos de las 12:00 comparten instante.
  mockStockMovements.push(
    movement({
      createdAt: "2026-09-10T12:00:00.000Z",
      id: "inv04-venta",
      quantityDelta: -1,
      saleId: "sale-inv04-a",
      type: "venta",
    }),
    movement({
      createdAt: "2026-09-12T15:00:00.000Z",
      id: "inv04-compra",
      productId: "prod-drill",
      purchaseId: "purchase-inv04-a",
      type: "compra",
    }),
    movement({
      createdAt: "2026-09-10T12:00:00.000Z",
      id: "inv04-ajuste",
      reason: "Conteo físico",
      type: "ajuste_entrada",
    }),
    movement({
      conversionId: "conv-inv04",
      createdAt: "2026-09-11T03:30:00.000Z",
      id: "inv04-conversion",
      quantityDelta: -1,
      type: "conversion_salida",
    }),
    movement({
      createdAt: "2026-09-08T10:00:00.000Z",
      id: "inv04-venta-rara",
      quantityDelta: -1,
      saleId: "sale-inv04-b",
      type: "venta",
    }),
    movement({
      createdAt: "2026-09-13T10:00:00.000Z",
      id: "inv04-otra-tienda",
      storeId: OTHER_STORE_ID,
      type: "ajuste_entrada",
    }),
  );
});

function movements(queryString: string) {
  return listStockMovements(new URLSearchParams(queryString), STORE_ID);
}

function stockCard(queryString: string) {
  return getStockCard(new URLSearchParams(queryString), STORE_ID);
}

function idsOf(result: { items: { id: string }[] }) {
  return result.items.map((item) => item.id);
}

function expectBadRequest(run: () => unknown, message?: string) {
  let error: unknown = null;

  try {
    run();
  } catch (reason) {
    error = reason;
  }

  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).status).toBe(400);

  if (message) {
    expect((error as ApiError).message).toBe(message);
  }
}

describe("inventory.mock-server · listStockMovements", () => {
  it("devuelve solo la tienda, del más reciente al más antiguo y con desempate estable", () => {
    const result = movements("limit=50");

    expect(idsOf(result)).toEqual([
      "inv04-compra",
      "inv04-conversion",
      // Mismo instante: gana el que está antes en la lista del mock.
      "inv04-venta",
      "inv04-ajuste",
      "inv04-venta-rara",
    ]);
    expect(result.total).toBe(5);
    expect(idsOf(movements("limit=50"))).toEqual(idsOf(result));
  });

  it("devuelve el documento resuelto y conserva el producto", () => {
    const byId = new Map(movements("limit=50").items.map((item) => [item.id, item]));

    expect(byId.get("inv04-venta")).toMatchObject({
      documentKind: "venta",
      documentNumber: "V-770001",
      product: { id: "prod-cable" },
      saleId: "sale-inv04-a",
    });
    expect(byId.get("inv04-compra")).toMatchObject({
      documentKind: "compra",
      documentNumber: "C-880001",
    });
    expect(byId.get("inv04-conversion")).toMatchObject({
      documentKind: "conversion",
      documentNumber: null,
    });
    expect(byId.get("inv04-ajuste")).toMatchObject({ documentKind: null, documentNumber: null });
  });

  it("filtra por tipo, producto, venta y compra exactos", () => {
    expect(idsOf(movements("type=venta"))).toEqual(["inv04-venta", "inv04-venta-rara"]);
    expect(idsOf(movements("productId=prod-drill"))).toEqual(["inv04-compra"]);
    expect(idsOf(movements("saleId=sale-inv04-a"))).toEqual(["inv04-venta"]);
    expect(idsOf(movements("purchaseId=purchase-inv04-a"))).toEqual(["inv04-compra"]);
    expect(idsOf(movements("type=venta&productId=prod-drill"))).toEqual([]);
  });

  it("filtra el rango por días de Caracas", () => {
    // 03:30 UTC del día 11 todavía es el día 10 en Caracas.
    expect(idsOf(movements("from=2026-09-10&to=2026-09-10"))).toEqual([
      "inv04-conversion",
      "inv04-venta",
      "inv04-ajuste",
    ]);
    expect(idsOf(movements("from=2026-09-11"))).toEqual(["inv04-compra"]);
    expect(idsOf(movements("to=2026-09-08"))).toEqual(["inv04-venta-rara"]);
  });

  it("filtra por tipo de documento", () => {
    expect(idsOf(movements("documentKind=venta"))).toEqual(["inv04-venta", "inv04-venta-rara"]);
    expect(idsOf(movements("documentKind=compra"))).toEqual(["inv04-compra"]);
    expect(idsOf(movements("documentKind=conversion"))).toEqual(["inv04-conversion"]);
    expect(idsOf(movements("documentKind=sin_documento"))).toEqual(["inv04-ajuste"]);
  });

  it("document busca texto parcial del número de venta o de compra, sin distinguir mayúsculas", () => {
    expect(idsOf(movements("document=770001"))).toEqual(["inv04-venta"]);
    expect(idsOf(movements("document=c-88"))).toEqual(["inv04-compra"]);
    expect(idsOf(movements("document=V-77"))).toEqual(["inv04-venta", "inv04-venta-rara"]);
    expect(idsOf(movements("document=NO-EXISTE"))).toEqual([]);
  });

  it("document se combina con el resto de filtros", () => {
    expect(idsOf(movements("document=V-77&from=2026-09-10"))).toEqual(["inv04-venta"]);
    expect(idsOf(movements("document=V-77&documentKind=compra"))).toEqual([]);
    expect(idsOf(movements("document=V-77&documentKind=sin_documento"))).toEqual([]);
    expect(idsOf(movements("document=C-88&documentKind=compra&type=compra"))).toEqual([
      "inv04-compra",
    ]);
  });

  it("document con comodines, comas y paréntesis no rompe ni lo devuelve todo", () => {
    const search = (term: string) => idsOf(movements(`document=${encodeURIComponent(term)}`));

    expect(search("(0),2")).toEqual(["inv04-venta-rara"]);
    // `%` y `_` casan con un carácter cualquiera, como en la base.
    expect(search("0),2%")).toEqual(["inv04-venta-rara"]);
    expect(search("V_77000")).toEqual(["inv04-venta"]);
    expect(search("V-77.*")).toEqual([]);
    expect(search("[")).toEqual([]);
    expect(search("%")).toEqual([]);
    expect(search('_*"\\')).toEqual([]);
  });

  it("document vacío o solo espacios no filtra", () => {
    expect(movements("document=%20").total).toBe(5);
    expect(movements("document=").total).toBe(5);
  });

  it("400 con tipo, fecha, rango o tipo de documento inválidos", () => {
    expectBadRequest(() => movements("type=regalo"), "El tipo de movimiento no es válido.");
    expectBadRequest(() => movements("from=10/09/2026"));
    expectBadRequest(() => movements("to=2026-02-30"));
    expectBadRequest(
      () => movements("from=2026-09-12&to=2026-09-10"),
      "La fecha inicial no puede ser posterior a la final.",
    );
    expectBadRequest(() => movements("documentKind=factura"), "El tipo de documento no es válido.");
    expectBadRequest(() => movements(`productId=${"a".repeat(201)}`));
  });

  it("skip más allá del total: items vacíos y el total real", () => {
    expect(movements("skip=500&limit=20&type=venta")).toEqual({
      items: [],
      limit: 20,
      skip: 500,
      total: 2,
    });
  });

  it("paginación inválida cae a valores seguros", () => {
    expect(movements("limit=abc&skip=-4")).toMatchObject({ limit: 10, skip: 0, total: 5 });
    expect(movements("limit=100000")).toMatchObject({ limit: 100 });
  });

  it("pagina sobre el orden del libro", () => {
    const all = idsOf(movements("limit=50"));

    expect(idsOf(movements("limit=10&skip=2"))).toEqual(all.slice(2));
  });
});

describe("inventory.mock-server · getStockCard", () => {
  it("filtra por producto, tipo y rango con el mismo orden", () => {
    expect(idsOf(stockCard("productId=prod-cable&limit=50"))).toEqual([
      "inv04-conversion",
      "inv04-venta",
      "inv04-ajuste",
      "inv04-venta-rara",
    ]);
    expect(idsOf(stockCard("productId=prod-cable&type=venta&from=2026-09-10"))).toEqual([
      "inv04-venta",
    ]);
  });

  it("no atiende los filtros de documento ni añade el documento resuelto", () => {
    const result = stockCard("document=NO-EXISTE&documentKind=compra&limit=50");

    expect(result.total).toBe(5);
    expect(result.items[0]).not.toHaveProperty("documentKind");
    expect(result.items[0]).not.toHaveProperty("documentNumber");
  });

  it("400 con tipo, fecha o rango inválidos", () => {
    expectBadRequest(() => stockCard("type=regalo"), "El tipo de movimiento no es válido.");
    expectBadRequest(() => stockCard("from=ayer"));
    expectBadRequest(
      () => stockCard("from=2026-09-12&to=2026-09-10"),
      "La fecha inicial no puede ser posterior a la final.",
    );
  });

  it("skip más allá del total: items vacíos y el total real", () => {
    expect(stockCard("productId=prod-drill&skip=40")).toEqual({
      items: [],
      limit: 10,
      skip: 40,
      total: 1,
    });
  });
});
