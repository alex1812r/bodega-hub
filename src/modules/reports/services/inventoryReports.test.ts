import { ApiError } from "@/lib/api/apiError";
import type { Permission } from "@/shared/auth/permissions";

import {
  assertInventoryReportAccess,
  buildDeadStockReport,
  buildStockAdjustmentsReport,
  buildStockTurnoverReport,
  inventoryProductHref,
  isManualAdjustmentMovement,
  isSaleLedgerMovement,
  normalizeAdjustmentReason,
  parseDeadStockQuery,
  parseStockAdjustmentsQuery,
  parseStockTurnoverQuery,
  type ProductLedgerRow,
  type StockAdjustmentInput,
  type StockFlowRow,
  type StockTurnoverMeasures,
} from "./inventoryReports";

const params = (query: string) => new URLSearchParams(query);

function expectBadRequest(run: () => unknown, message: RegExp) {
  let thrown: unknown;

  try {
    run();
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(ApiError);
  expect((thrown as ApiError).status).toBe(400);
  expect((thrown as ApiError).message).toMatch(message);
}

function product(overrides: Partial<ProductLedgerRow> & { productId: string }): ProductLedgerRow {
  const stock = overrides.stock ?? 0;
  const costRef = overrides.costRef ?? 1;

  return {
    categoryId: "c1",
    categoryName: "Bebidas",
    costRef,
    idleSince: "2026-01-01",
    isActive: true,
    lastMovementAt: null,
    lastSaleAt: null,
    name: `Producto ${overrides.productId}`,
    sku: `SKU-${overrides.productId}`,
    stock,
    stockValueRef: Math.round(stock * costRef * 100) / 100,
    ...overrides,
  };
}

/** Ningún número del árbol es NaN ni Infinity. */
function expectFiniteNumbers(value: unknown) {
  if (typeof value === "number") {
    expect(Number.isFinite(value)).toBe(true);
  } else if (Array.isArray(value)) {
    value.forEach(expectFiniteNumbers);
  } else if (value && typeof value === "object") {
    Object.values(value).forEach(expectFiniteNumbers);
  }
}

describe("permisos de los reportes de inventario", () => {
  it.each<[string, Permission[], boolean]>([
    ["reports.view + inventory.view", ["reports.view", "inventory.view"], true],
    ["solo reports.view", ["reports.view"], false],
    ["solo inventory.view", ["inventory.view"], false],
    ["ninguno", [], false],
  ])("%s", (_label, permissions, allowed) => {
    const run = () => assertInventoryReportAccess({ permissions });

    if (allowed) {
      expect(run).not.toThrow();
    } else {
      expect(run).toThrow(expect.objectContaining({ code: "FORBIDDEN", status: 403 }));
    }
  });
});

describe("clasificación de movimientos del libro", () => {
  it.each([
    [{ type: "venta" as const, saleId: "s1" }, true, false],
    [{ type: "devolucion_cliente" as const, saleId: "s1" }, true, false],
    // Anular o devolver una venta deja un ajuste_entrada ligado a ella: es reversión de venta, no ajuste.
    [{ type: "ajuste_entrada" as const, saleId: "s1" }, true, false],
    [{ type: "ajuste_entrada" as const }, false, true],
    [{ type: "ajuste_entrada" as const, saleId: null, purchaseId: null }, false, true],
    [{ type: "ajuste_salida" as const }, false, true],
    // Anular una compra deja un ajuste_salida ligado a ella: no es ajuste manual ni venta.
    [{ type: "ajuste_salida" as const, purchaseId: "c1" }, false, false],
    [{ type: "inventario_inicial" as const }, false, false],
    [{ type: "compra" as const, purchaseId: "c1" }, false, false],
    [{ type: "devolucion_proveedor" as const, purchaseId: "c1" }, false, false],
    [{ type: "conversion_salida" as const }, false, false],
    [{ type: "conversion_entrada" as const }, false, false],
  ])("%j → venta %s, ajuste manual %s", (movement, isSale, isAdjustment) => {
    expect(isSaleLedgerMovement(movement)).toBe(isSale);
    expect(isManualAdjustmentMovement(movement)).toBe(isAdjustment);
  });

  it.each([
    ["  Conteo   físico ", "Conteo físico"],
    ["Merma", "Merma"],
    ["", "Sin motivo"],
    ["   ", "Sin motivo"],
    [null, "Sin motivo"],
    [undefined, "Sin motivo"],
  ])("motivo %j → %s", (reason, expected) => {
    expect(normalizeAdjustmentReason(reason)).toBe(expected);
  });

  it("el enlace del producto va a su detalle", () => {
    expect(inventoryProductHref("abc")).toBe("/products/abc");
  });
});

describe("productos sin movimiento: parámetros", () => {
  it("por defecto 30 días, primera página y sin categoría", () => {
    expect(parseDeadStockQuery(params(""))).toEqual({ days: 30, limit: 10, skip: 0 });
  });

  it("acepta días, categoría y paginación", () => {
    expect(parseDeadStockQuery(params("days=3650&categoryId= cat-1 &skip=20&limit=50"))).toEqual({
      categoryId: "cat-1",
      days: 3650,
      limit: 50,
      skip: 20,
    });
    expect(parseDeadStockQuery(params("days=1")).days).toBe(1);
    expect(parseDeadStockQuery(params("days=&categoryId=")).days).toBe(30);
  });

  it.each(["0", "3651", "-3", "1.5", "abc", "1e2", "0x10", "999999", "30 días"])(
    "rechaza days=%s con 400 en español",
    (days) => {
      expectBadRequest(
        () => parseDeadStockQuery(params(`days=${encodeURIComponent(days)}`)),
        /Los días sin movimiento deben ser un número entero entre 1 y 3650\./,
      );
    },
  );

  it("rechaza una categoría desmesurada", () => {
    expectBadRequest(() => parseDeadStockQuery(params(`categoryId=${"x".repeat(121)}`)), /La categoría no es válida\./);
  });
});

describe("productos sin movimiento: reporte", () => {
  const TODAY = "2026-05-18";
  const rows = [
    product({ productId: "b", stock: 4, costRef: 5, idleSince: "2026-03-01", categoryId: "c2", categoryName: "Snacks" }),
    product({
      productId: "a",
      stock: 10,
      costRef: 2,
      // Exactamente 30 días: entra.
      idleSince: "2026-04-18",
      lastMovementAt: "2026-05-17T15:00:00.000Z",
      lastSaleAt: "2026-04-18T15:00:00.000Z",
    }),
    // 29 días: no entra, pero su valor sí cuenta en el inventario.
    product({ productId: "c", stock: 6, costRef: 1.25, idleSince: "2026-04-19" }),
    product({ productId: "d", stock: 5, costRef: 10, isActive: false }),
    product({ productId: "e", stock: 0, costRef: 9 }),
    product({ productId: "f", stock: 3, costRef: 10, categoryId: null, categoryName: "Sin categoría" }),
  ];

  it("entran los activos con stock y N días sin vender, por valor inmovilizado e id", () => {
    const report = buildDeadStockReport({ query: { days: 30, limit: 10, skip: 0 }, rows, today: TODAY });

    expect(report.items.map((item) => [item.product.id, item.stockValueRef, item.daysIdle])).toEqual([
      ["f", 30, 137],
      ["a", 20, 30],
      ["b", 20, 78],
    ]);
    expect(report.items[1]).toEqual({
      category: { id: "c1", name: "Bebidas" },
      costRef: 2,
      daysIdle: 30,
      daysSinceLastMovement: 1,
      idleSince: "2026-04-18",
      lastMovementAt: "2026-05-17T15:00:00.000Z",
      lastSaleAt: "2026-04-18T15:00:00.000Z",
      product: { href: "/products/a", id: "a", name: "Producto a", sku: "SKU-a" },
      stock: 10,
      stockValueRef: 20,
    });
    expect(report.items[0]).toEqual(
      expect.objectContaining({ category: { id: null, name: "Sin categoría" }, daysSinceLastMovement: null, lastSaleAt: null }),
    );
    expect(report).toEqual(
      expect.objectContaining({
        asOf: TODAY,
        days: 30,
        limit: 10,
        skip: 0,
        // 70 de 77,50 (a + b + c + f): ni el inactivo ni el que no tiene stock son inventario.
        summary: { idleValuePct: 90.32, idleValueRef: 70, inventoryValueRef: 77.5, productsCount: 3 },
        total: 3,
      }),
    );
  });

  it("el último movimiento se cuenta en día Caracas, no en UTC", () => {
    const report = buildDeadStockReport({
      query: { days: 1, limit: 10, skip: 0 },
      // 02:30 UTC del 18 = 22:30 del 17 en Caracas.
      rows: [product({ productId: "a", stock: 1, lastMovementAt: "2026-05-18T02:30:00.000Z" })],
      today: TODAY,
    });

    expect(report.items[0]?.daysSinceLastMovement).toBe(1);
  });

  it("el resumen es de todo el conjunto, no de la página", () => {
    const first = buildDeadStockReport({ query: { days: 30, limit: 2, skip: 0 }, rows, today: TODAY });
    const second = buildDeadStockReport({ query: { days: 30, limit: 2, skip: 2 }, rows, today: TODAY });

    expect(first.items.map((item) => item.product.id)).toEqual(["f", "a"]);
    expect(second.items.map((item) => item.product.id)).toEqual(["b"]);
    expect(second.summary).toEqual(first.summary);
    expect(second.total).toBe(3);
  });

  it("con categoría, el conjunto y el valor de inventario son los de esa categoría", () => {
    const report = buildDeadStockReport({ query: { categoryId: "c1", days: 30, limit: 10, skip: 0 }, rows, today: TODAY });

    expect(report.items.map((item) => item.product.id)).toEqual(["a"]);
    expect(report.summary).toEqual({ idleValuePct: 72.73, idleValueRef: 20, inventoryValueRef: 27.5, productsCount: 1 });
  });

  it("sin inventario el porcentaje es null, nunca NaN", () => {
    const report = buildDeadStockReport({ query: { days: 30, limit: 10, skip: 0 }, rows: [], today: TODAY });

    expect(report.summary).toEqual({ idleValuePct: null, idleValueRef: 0, inventoryValueRef: 0, productsCount: 0 });
    expect(report.items).toEqual([]);
    expectFiniteNumbers(report);
  });
});

describe("rotación: parámetros", () => {
  it("exige el rango y agrupa por producto si no se indica", () => {
    expect(parseStockTurnoverQuery(params("from=2026-05-01&to=2026-05-10"))).toEqual({
      from: "2026-05-01",
      groupBy: "product",
      limit: 10,
      skip: 0,
      to: "2026-05-10",
    });
    expect(parseStockTurnoverQuery(params("from=2026-05-01&to=2026-05-10&groupBy=category&limit=25&skip=50"))).toEqual(
      expect.objectContaining({ groupBy: "category", limit: 25, skip: 50 }),
    );
  });

  it.each([
    ["", /Indica las fechas/],
    ["from=2026-05-01", /Indica las fechas/],
    ["from=2026-05-11&to=2026-05-10", /no puede ser posterior/],
    ["from=2000-01-01&to=2026-05-10", /demasiado amplio/],
    ["from=2026-05-01&to=2026-05-10&groupBy=day", /La agrupación no es válida\. Usa product o category\./],
    ["from=2026-05-01&to=2026-05-10&groupBy=vendedor", /La agrupación no es válida/],
  ])("rechaza \"%s\" con 400 en español", (query, message) => {
    expectBadRequest(() => parseStockTurnoverQuery(params(query)), message);
  });
});

describe("rotación: reporte", () => {
  const range = { from: "2026-05-01", to: "2026-05-10" };
  const products = [
    product({ productId: "p1", stock: 10, costRef: 2 }),
    product({ productId: "p2", stock: 0, costRef: 3 }),
    product({ productId: "p3", stock: 7, costRef: 1, categoryId: "c2", categoryName: "Snacks" }),
    // Sin saldo y sin ventas en el rango: no aparece.
    product({ productId: "p4", stock: 0, costRef: 4 }),
    // Costo 0: el inventario promedio no vale nada.
    product({ productId: "p5", stock: 0, costRef: 0, categoryId: null, categoryName: "Sin categoría" }),
    // Más devuelto que vendido en el rango.
    product({ productId: "p6", stock: 5, costRef: 2, categoryId: null, categoryName: "Sin categoría" }),
  ];
  const flow: StockFlowRow[] = [
    // Antes del rango: no cuenta.
    { cogsRef: 10, day: "2026-04-20", netDelta: -5, productId: "p1", soldUnits: 5 },
    { cogsRef: 4.5, day: "2026-05-02", netDelta: -3, productId: "p1", soldUnits: 3 },
    { cogsRef: 0, day: "2026-05-05", netDelta: 10, productId: "p1", soldUnits: 0 },
    // Después del rango: solo sirve para reconstruir el saldo de cierre.
    { cogsRef: 4, day: "2026-05-12", netDelta: -2, productId: "p1", soldUnits: 2 },
    { cogsRef: 12, day: "2026-05-03", netDelta: -4, productId: "p2", soldUnits: 4 },
    { cogsRef: 0, day: "2026-05-04", netDelta: -2, productId: "p5", soldUnits: 2 },
    { cogsRef: -2, day: "2026-05-06", netDelta: 1, productId: "p6", soldUnits: -1 },
  ];
  const measures = (row: StockTurnoverMeasures) => [
    row.openingStock,
    row.closingStock,
    row.soldUnits,
    row.cogsRef,
    row.averageStockValueRef,
    row.turnover,
    row.daysOfInventory,
  ];

  it("por producto: saldos de apertura y cierre del libro, rotación y días de inventario", () => {
    const report = buildStockTurnoverReport({ flow, products, query: { ...range, groupBy: "product", limit: 10, skip: 0 } });

    expect(report.items.map((row) => [row.key, ...measures(row)])).toEqual([
      // apertura, cierre, vendidas, costo de ventas, inventario promedio, rotación, días
      ["p2", 4, 0, 4, 12, 6, 2, 5],
      ["p1", 5, 12, 3, 4.5, 17, 0.26, 37.78],
      ["p3", 7, 7, 0, 0, 7, 0, null],
      ["p6", 4, 5, -1, -2, 9, -0.22, null],
      ["p5", 2, 0, 2, 0, 0, null, null],
    ]);
    expect(report.items[1]).toEqual(
      expect.objectContaining({
        category: { id: "c1", name: "Bebidas" },
        product: { href: "/products/p1", id: "p1", name: "Producto p1", sku: "SKU-p1" },
        productsCount: 1,
        stock: 10,
        stockValueRef: 20,
      }),
    );
    expect(report).toEqual(
      expect.objectContaining({
        groupBy: "product",
        inventoryBasis: "average_opening_closing",
        range,
        rangeDays: 10,
        total: 5,
      }),
    );
    expect(report.totals).toEqual({
      averageStockValueRef: 39,
      closingStock: 24,
      cogsRef: 14.5,
      daysOfInventory: 26.9,
      openingStock: 22,
      soldUnits: 8,
      stock: 22,
      stockValueRef: 37,
      turnover: 0.37,
    });
    expectFiniteNumbers(report);
  });

  it("por categoría: mismas sumas y mismos totales que por producto", () => {
    const byProduct = buildStockTurnoverReport({ flow, products, query: { ...range, groupBy: "product", limit: 10, skip: 0 } });
    const report = buildStockTurnoverReport({ flow, products, query: { ...range, groupBy: "category", limit: 10, skip: 0 } });

    expect(report.items.map((row) => [row.key, row.category.name, row.productsCount, ...measures(row)])).toEqual([
      ["c1", "Bebidas", 2, 9, 12, 7, 16.5, 23, 0.72, 13.94],
      ["c2", "Snacks", 1, 7, 7, 0, 0, 7, 0, null],
      ["", "Sin categoría", 2, 6, 5, 1, -2, 9, -0.22, null],
    ]);
    expect(report.items.every((row) => row.product === null)).toBe(true);
    expect(report.totals).toEqual(byProduct.totals);
    expectFiniteNumbers(report);
  });

  it("pagina sin cambiar los totales", () => {
    const page = buildStockTurnoverReport({ flow, products, query: { ...range, groupBy: "product", limit: 2, skip: 2 } });
    const all = buildStockTurnoverReport({ flow, products, query: { ...range, groupBy: "product", limit: 10, skip: 0 } });

    expect(page.items.map((row) => row.key)).toEqual(["p3", "p6"]);
    expect(page.total).toBe(5);
    expect(page.totals).toEqual(all.totals);
  });

  it("sin datos: totales en 0 con rotación y días en null", () => {
    const report = buildStockTurnoverReport({ flow: [], products: [], query: { ...range, groupBy: "product", limit: 10, skip: 0 } });

    expect(report.items).toEqual([]);
    expect(report.totals).toEqual(
      expect.objectContaining({ averageStockValueRef: 0, cogsRef: 0, daysOfInventory: null, soldUnits: 0, turnover: null }),
    );
    expectFiniteNumbers(report);
  });
});

describe("ajustes y mermas: parámetros", () => {
  it("exige el rango; sin agrupación (o auto) queda automática", () => {
    expect(parseStockAdjustmentsQuery(params("from=2026-05-04&to=2026-05-06"))).toEqual({
      from: "2026-05-04",
      groupBy: null,
      limit: 10,
      skip: 0,
      to: "2026-05-06",
    });
    expect(parseStockAdjustmentsQuery(params("from=2026-05-04&to=2026-05-06&groupBy=auto")).groupBy).toBeNull();
    expect(parseStockAdjustmentsQuery(params("from=2026-05-04&to=2026-05-06&groupBy=month&skip=10")).groupBy).toBe("month");
  });

  it.each([
    ["", /Indica las fechas/],
    ["to=2026-05-06", /Indica las fechas/],
    ["from=ayer&to=2026-05-06", /"desde" no es válida/],
    ["from=2026-05-04&to=2026-05-06&groupBy=product", /La agrupación no es válida\. Usa day, week, month o auto\./],
  ])("rechaza \"%s\" con 400 en español", (query, message) => {
    expectBadRequest(() => parseStockAdjustmentsQuery(params(query)), message);
  });
});

describe("ajustes y mermas: reporte", () => {
  const range = { from: "2026-05-04", to: "2026-05-06" };
  const adjustment = (
    seq: number,
    date: string,
    quantityDelta: number,
    unitCostRef: number,
    reason: string,
    productId = "p1",
  ): StockAdjustmentInput => ({
    createdAt: `${date}T15:00:00.000Z`,
    date,
    movementId: `m${seq}`,
    productId,
    productName: `Producto ${productId}`,
    quantityDelta,
    reason,
    seq,
    sku: `SKU-${productId}`,
    type: quantityDelta > 0 ? "ajuste_entrada" : "ajuste_salida",
    unitCostRef,
    valueRef: Math.round(quantityDelta * unitCostRef * 100) / 100,
  });
  const rows = [
    // Fuera del rango: se ignora.
    adjustment(9, "2026-05-03", -50, 2, "Merma"),
    adjustment(11, "2026-05-04", -3, 2, "Merma"),
    adjustment(10, "2026-05-04", 2, 2, "Conteo físico"),
    adjustment(13, "2026-05-06", -2, 2, "Merma"),
    adjustment(12, "2026-05-06", -1, 3.5, "Sin motivo", "p2"),
  ];
  const zero = { movementsCount: 0, netUnits: 0, netValueRef: 0, unitsIn: 0, unitsOut: 0, valueInRef: 0, valueOutRef: 0 };

  it("resumen por motivo, serie sin huecos, totales y filas en el orden del libro", () => {
    const report = buildStockAdjustmentsReport({ query: { ...range, groupBy: null, limit: 10, skip: 0 }, rows });

    expect(report.costBasis).toBe("current_cost");
    // 3 días: la agrupación automática es por día.
    expect(report.groupBy).toBe("day");
    expect(report.range).toEqual(range);
    expect(report.totals).toEqual({
      movementsCount: 4,
      netUnits: -4,
      netValueRef: -9.5,
      unitsIn: 2,
      unitsOut: 6,
      valueInRef: 4,
      valueOutRef: 13.5,
    });
    expect(report.byReason).toEqual([
      { ...zero, movementsCount: 2, netUnits: -5, netValueRef: -10, reason: "Merma", unitsOut: 5, valueOutRef: 10 },
      { ...zero, movementsCount: 1, netUnits: 2, netValueRef: 4, reason: "Conteo físico", unitsIn: 2, valueInRef: 4 },
      { ...zero, movementsCount: 1, netUnits: -1, netValueRef: -3.5, reason: "Sin motivo", unitsOut: 1, valueOutRef: 3.5 },
    ]);
    expect(report.series.map(({ from, key, to, ...bucketMeasures }) => [key, from, to, bucketMeasures])).toEqual([
      [
        "2026-05-04",
        "2026-05-04",
        "2026-05-04",
        expect.objectContaining({ movementsCount: 2, netUnits: -1, netValueRef: -2, unitsIn: 2, unitsOut: 3, valueInRef: 4, valueOutRef: 6 }),
      ],
      ["2026-05-05", "2026-05-05", "2026-05-05", expect.objectContaining(zero)],
      [
        "2026-05-06",
        "2026-05-06",
        "2026-05-06",
        expect.objectContaining({ movementsCount: 2, netUnits: -3, netValueRef: -7.5, unitsIn: 0, unitsOut: 3, valueInRef: 0, valueOutRef: 7.5 }),
      ],
    ]);
    expect(report.items.map((item) => item.movementId)).toEqual(["m13", "m12", "m11", "m10"]);
    expect(report.items[1]).toEqual({
      createdAt: "2026-05-06T15:00:00.000Z",
      date: "2026-05-06",
      movementId: "m12",
      product: { href: "/products/p2", id: "p2", name: "Producto p2", sku: "SKU-p2" },
      quantityDelta: -1,
      reason: "Sin motivo",
      type: "ajuste_salida",
      unitCostRef: 3.5,
      valueRef: -3.5,
    });
    expect(report.total).toBe(4);
    expectFiniteNumbers(report);
  });

  it("la serie y los motivos suman lo mismo que los totales, con cualquier agrupación", () => {
    for (const groupBy of ["day", "week", "month"] as const) {
      const report = buildStockAdjustmentsReport({ query: { ...range, groupBy, limit: 10, skip: 0 }, rows });
      const sum = (values: number[]) => Math.round(values.reduce((total, value) => total + value, 0) * 100) / 100;

      expect(report.groupBy).toBe(groupBy);
      expect(sum(report.series.map((bucket) => bucket.netValueRef))).toBe(report.totals.netValueRef);
      expect(sum(report.series.map((bucket) => bucket.unitsOut))).toBe(report.totals.unitsOut);
      expect(sum(report.byReason.map((reason) => reason.valueOutRef))).toBe(report.totals.valueOutRef);
      expect(sum(report.byReason.map((reason) => reason.movementsCount))).toBe(report.totals.movementsCount);
    }
  });

  it("pagina las filas sin cambiar resumen, serie ni totales", () => {
    const all = buildStockAdjustmentsReport({ query: { ...range, groupBy: "day", limit: 10, skip: 0 }, rows });
    const page = buildStockAdjustmentsReport({ query: { ...range, groupBy: "day", limit: 2, skip: 1 }, rows });

    expect(page.items.map((item) => item.movementId)).toEqual(["m12", "m11"]);
    expect(page).toEqual({ ...all, items: page.items, limit: 2, skip: 1 });
  });

  it("sin ajustes: todo en 0 y la serie completa", () => {
    const report = buildStockAdjustmentsReport({ query: { ...range, groupBy: "day", limit: 10, skip: 0 }, rows: [] });

    expect(report.totals).toEqual(zero);
    expect(report.byReason).toEqual([]);
    expect(report.items).toEqual([]);
    expect(report.series).toHaveLength(3);
  });
});
