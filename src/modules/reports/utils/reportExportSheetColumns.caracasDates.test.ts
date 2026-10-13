/**
 * REP-F9: las columnas de fecha de la exportación (vista previa, PDF y Excel)
 * que son instantes salen en su día operativo de Caracas, como en pantalla, y
 * no en la zona del navegador. 03:30 UTC del día 11 son las 23:30 del día 10 en
 * Caracas y las 12:30 del día 11 en Tokio.
 *
 * @jest-environment ./src/modules/reports/reports-list/testing/tokyoTimezoneEnvironment.ts
 */
import * as columns from "./reportExportSheetColumns";

const EDGE = "2026-05-11T03:30:00.000Z";

function cell<Row>(list: columns.ReportExportColumn<Row>[], header: string, row: Partial<Row>) {
  const column = list.find((item) => item.header === header);

  if (!column) {
    throw new Error(`Sin columna «${header}»`);
  }

  return column.value(row as Row);
}

describe("columnas de exportación · fechas en día operativo de Caracas (REP-F9)", () => {
  it("la prueba corre con el reloj local en Tokio", () => {
    expect(new Date(EDGE).getDate()).toBe(11);
    expect(new Date(EDGE).getHours()).toBe(12);
  });

  it("kardex y compras: el instante sale en el día 10", () => {
    expect(cell(columns.stockCardExportColumns, "Fecha", { createdAt: EDGE })).toBe("10/05/2026");
    expect(cell(columns.purchasesExportColumns, "Fecha", { createdAt: EDGE })).toBe("10/05/2026");
  });

  it("«última compra» de clientes y proveedores sale en el día 10", () => {
    expect(
      cell(columns.customerPurchasesExportColumns, "Última compra", { lastPurchaseAt: EDGE }),
    ).toBe("10/05/2026");
    expect(
      cell(columns.supplierPurchasesExportColumns, "Última compra", { lastPurchaseAt: EDGE }),
    ).toBe("10/05/2026");
  });

  it("«última venta» del stock sin movimiento sale en el día 10", () => {
    expect(cell(columns.deadStockExportColumns, "Última venta", { lastSaleAt: EDGE })).toBe(
      "10/05/2026",
    );
  });

  it("sin fecha se conserva el texto de siempre", () => {
    expect(cell(columns.customerPurchasesExportColumns, "Última compra", {})).toBe("Sin compras");
    expect(cell(columns.supplierPurchasesExportColumns, "Última compra", {})).toBe("Sin compras");
    expect(cell(columns.deadStockExportColumns, "Última venta", { lastSaleAt: null })).toBe("Nunca");
  });

  it("las columnas que ya son un día de Caracas no se desplazan", () => {
    const day = "2026-05-10";

    expect(cell(columns.dailySalesExportColumns, "Fecha", { saleDate: day })).toBe("10/05/2026");
    expect(cell(columns.grossProfitExportColumns, "Fecha", { saleDate: day })).toBe("10/05/2026");
    expect(cell(columns.fxDepreciationExportColumns, "Fecha", { saleDate: day })).toBe("10/05/2026");
    expect(cell(columns.receivablesAgingExportColumns, "Fecha", { date: day })).toBe("10/05/2026");
    expect(cell(columns.payablesAgingExportColumns, "Fecha", { date: day })).toBe("10/05/2026");
    expect(cell(columns.cashCloseDifferencesExportColumns, "Fecha de cierre", { closeDate: day })).toBe(
      "10/05/2026",
    );
    expect(cell(columns.stockAdjustmentsExportColumns, "Fecha", { date: day })).toBe("10/05/2026");
  });

  it("la fecha sigue siendo texto: el Excel no cambia el tipo de celda", () => {
    expect(typeof cell(columns.stockCardExportColumns, "Fecha", { createdAt: EDGE })).toBe("string");
  });
});
