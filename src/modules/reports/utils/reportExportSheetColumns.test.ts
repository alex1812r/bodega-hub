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
