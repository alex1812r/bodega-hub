import * as columns from "./reportExportSheetColumns";

// REP-F2: cabeceras de las hojas con tilde y sin el id interno del producto.
describe("columnas de exportación", () => {
  const headers = Object.values(columns).flatMap((value) =>
    Array.isArray(value) ? value.map((column) => column.header) : [],
  );

  it("las cabeceras llevan tilde", () => {
    expect(headers).toEqual(
      expect.arrayContaining(["Mínimo", "Última compra", "Pérdida REF", "Método"]),
    );
    expect(headers.join(" ")).not.toMatch(/Minimo|Ultima|Perdida|Metodo/);
  });

  it("las hojas de producto exportan el nombre (o el SKU), nunca el id interno", () => {
    const product = { name: "Pintura blanca galón", productId: "uuid-1", sku: "pin-bla-001" };
    const valueOf = <Row>(list: columns.ReportExportColumn<Row>[], row: Row) =>
      list.find((column) => column.header === "Producto")?.value(row);

    expect(
      valueOf(columns.topProductsExportColumns, { ...product, revenueRef: 1, unitsSold: 1 }),
    ).toBe("Pintura blanca galón");
    expect(
      valueOf(columns.topProductsExportColumns, {
        ...product,
        name: undefined,
        revenueRef: 1,
        unitsSold: 1,
      }),
    ).toBe("pin-bla-001");
    expect(
      valueOf(columns.productProfitabilityExportColumns, {
        ...product,
        costRef: 1,
        grossProfitRef: 1,
        unitsSold: 1,
      }),
    ).toBe("Pintura blanca galón");
    expect(
      valueOf(columns.stockCardExportColumns, {
        createdAt: "2026-05-18T12:00:00.000Z",
        id: "mov-1",
        productId: "uuid-1",
        productName: "Pintura blanca galón",
        quantityDelta: 1,
        stockAfter: 2,
        type: "venta",
      }),
    ).toBe("Pintura blanca galón");
  });
});

// REP-08: reportes de dinero e inventario en la exportación.
describe("columnas de los reportes de la tienda activa", () => {
  const cells = <Row>(list: columns.ReportExportColumn<Row>[], row: Row) =>
    Object.fromEntries(list.map((column) => [column.header, column.value(row)]));

  it("cuentas por cobrar y por pagar: documento, contacto por nombre y tramo legible", () => {
    const row = {
      bucket: "30+",
      contact: { id: "uuid-contacto", name: "María Pérez" },
      createdAt: "2026-04-01T12:00:00.000Z",
      date: "2026-04-01",
      days: 47,
      document: { href: "/sales/uuid-venta", id: "uuid-venta", number: "FAC-0001", type: "sale" },
      paidRef: 2,
      paidVes: 73,
      pendingRef: 8,
      pendingVes: 292,
      refRateVes: 36.5,
      totalRef: 10,
      totalVes: 365,
    } as const;
    const receivable = cells(columns.receivablesAgingExportColumns, row);

    expect(receivable).toMatchObject({
      Cliente: "María Pérez",
      Documento: "FAC-0001",
      Días: 47,
      "Pendiente REF": 8,
      "Pendiente VES": 292,
      Tramo: "Más de 30 días",
    });
    expect(Object.values(receivable).join(" ")).not.toMatch(/uuid/);
    expect(cells(columns.payablesAgingExportColumns, { ...row, contact: null })).toMatchObject({
      Proveedor: "Sin contacto",
    });
  });

  it("diferencias de cierre: moneda y motivo legibles, importes como números", () => {
    expect(
      cells(columns.cashCloseDifferencesExportColumns, {
        cashSessionId: "uuid-sesion",
        closeDate: "2026-05-17",
        closedAt: "2026-05-17T22:00:00.000Z",
        closedReason: "end_of_day",
        counted: 95,
        currency: "ves",
        difference: -5,
        expected: 100,
        registerId: "uuid-caja",
        registerName: null,
        runningDifference: -7,
      }),
    ).toMatchObject({
      Caja: "Caja",
      Cierre: "Fin de día",
      Contado: 95,
      Diferencia: -5,
      "Diferencia acumulada": -7,
      Esperado: 100,
      Moneda: "Bs",
    });
  });

  it("ventas por hora y por categoría", () => {
    expect(
      cells(columns.salesByHourExportColumns, {
        hour: 9,
        salesCount: 2,
        totalRef: 30,
        totalVes: 1095,
        weekday: "martes",
      }),
    ).toEqual({ Día: "martes", Hora: "09:00", "Total REF": 30, "Total VES": 1095, Ventas: 2 });
    expect(
      cells(columns.salesByCategoryExportColumns, {
        categoryId: null,
        categoryName: "Sin categoría",
        costRef: 0,
        grossProfitRef: 0,
        marginPct: null,
        markupPct: null,
        revenueRef: 0,
        units: 0,
      }),
    ).toMatchObject({ Categoría: "Sin categoría", "Margen %": "N/D" });
  });

  it("inventario: producto por nombre, rotación por categoría y ajustes con su tipo", () => {
    const product = { href: "/products/uuid-1", id: "uuid-1", name: "Harina PAN 1 kg", sku: "har-001" };
    const category = { id: "uuid-cat", name: "Víveres" };

    expect(
      cells(columns.deadStockExportColumns, {
        category,
        costRef: 1.2,
        daysIdle: 45,
        daysSinceLastMovement: 45,
        idleSince: "2026-04-03",
        lastMovementAt: null,
        lastSaleAt: null,
        product,
        stock: 10,
        stockValueRef: 12,
      }),
    ).toMatchObject({
      Categoría: "Víveres",
      "Días sin vender": 45,
      Producto: "Harina PAN 1 kg",
      "Última venta": "Nunca",
      "Valor inmovilizado REF": 12,
    });

    const turnover = {
      averageStockValueRef: 0,
      category,
      closingStock: 0,
      cogsRef: 0,
      daysOfInventory: null,
      key: "uuid-cat",
      openingStock: 0,
      product: null,
      productsCount: 3,
      soldUnits: 0,
      stock: 0,
      stockValueRef: 0,
      turnover: null,
    };

    expect(cells(columns.stockTurnoverExportColumns, turnover)).toMatchObject({
      "Días de inventario": "N/D",
      Nombre: "Víveres",
      Rotación: "N/D",
      SKU: "",
    });
    expect(
      cells(columns.stockTurnoverExportColumns, { ...turnover, product, turnover: 2.5 }),
    ).toMatchObject({ Nombre: "Harina PAN 1 kg", Rotación: 2.5, SKU: "har-001" });
    expect(
      cells(columns.stockAdjustmentsExportColumns, {
        createdAt: "2026-05-02T12:00:00.000Z",
        date: "2026-05-02",
        movementId: "uuid-mov",
        product,
        quantityDelta: -3,
        reason: "Merma",
        type: "ajuste_salida",
        unitCostRef: 1.2,
        valueRef: -3.6,
      }),
    ).toMatchObject({ Cantidad: -3, Motivo: "Merma", Producto: "Harina PAN 1 kg", Tipo: "Salida" });
  });

  it("compras sin proveedor cargado no muestran su id interno", () => {
    const value = columns.purchasesExportColumns
      .find((column) => column.header === "Proveedor")
      ?.value({ supplierId: "uuid-proveedor" } as never);

    expect(value).toBe("Sin proveedor");
  });
});
