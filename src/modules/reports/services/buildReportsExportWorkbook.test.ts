/**
 * @jest-environment node
 */

import ExcelJS from "exceljs";

import { EXCEL_CELL_MAX_LENGTH } from "@/modules/inventory/utils/excelCell";
import { getRolePermissions } from "@/shared/auth/permissions";

import { reportCatalog } from "../reports-list/config/reportCatalog";
import { buildReportsExportWorkbook } from "./buildReportsExportWorkbook";
import type { ChartImage } from "./captureChartImage";
import type { ReportsExportDataset, ReportsExportFilters } from "./fetchReportsForExport";

const emptyDataset: ReportsExportDataset = {
  customerPurchases: [],
  dailyClose: [],
  dailySales: [],
  fxDepreciation: [],
  grossProfit: [],
  lowStock: [],
  paymentMethods: [],
  productProfitability: [],
  purchases: [],
  stockCard: [],
  supplierPurchases: [],
  topCustomers: [],
  topProducts: [],
};

const dailySales = [
  { paidVes: 300, saleDate: "2026-05-02", salesCount: 2, totalRef: 10, totalVes: 365 },
  { paidVes: 100, saleDate: "2026-05-03", salesCount: 1, totalRef: 4, totalVes: 146 },
];

/** PNG válido de 1 × 1. */
const chartImage: ChartImage = {
  dataUrl:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  height: 480,
  width: 960,
};

const exportedAt = "2026-05-20T12:00:00.000Z";
const range = { from: "2026-05-01", to: "2026-05-18" };
const baseFilters: ReportsExportFilters = {
  dateFilters: range,
  purchasesFilters: {},
  stockCardFilters: {},
};

function viewFilters(activeReportId: string): ReportsExportFilters {
  return {
    ...baseFilters,
    view: {
      activeReportId,
      compare: false,
      viewer: { permissions: getRolePermissions("admin"), role: "admin" },
    },
  };
}

async function build(
  data: ReportsExportDataset,
  filters: ReportsExportFilters = baseFilters,
  image: ChartImage | null = null,
) {
  const buffer = await buildReportsExportWorkbook(data, { chartImage: image, exportedAt, filters });
  const workbook = new ExcelJS.Workbook();

  await workbook.xlsx.load(buffer);

  return workbook;
}

function columnA(worksheet: ExcelJS.Worksheet | undefined) {
  const values: unknown[] = [];

  worksheet?.eachRow({ includeEmpty: true }, (row) => values.push(row.getCell(1).value));

  return values;
}

/** Número de fila (base 1) de la fila de cabeceras de columna. */
function headerRowNumber(worksheet: ExcelJS.Worksheet | undefined, firstHeader: string) {
  return columnA(worksheet).indexOf(firstHeader) + 1;
}

describe("buildReportsExportWorkbook", () => {
  it("crea una hoja por reporte, con su nombre", async () => {
    const workbook = await build(emptyDataset);

    expect(workbook.worksheets.map((worksheet) => worksheet.name)).toEqual(
      reportCatalog.map((report) => report.name),
    );
  });

  it("cada hoja abre con el nombre del reporte, el rango y la fecha de generación", async () => {
    const workbook = await build({ ...emptyDataset, dailySales, storeName: "Bodega Demo" });
    const sheet = workbook.getWorksheet("Ventas diarias");

    expect(columnA(sheet)).toEqual([
      "Ventas diarias",
      "Periodo: del 1 may 2026 al 18 may 2026",
      "Tienda: Bodega Demo",
      "Generado: 20/05/2026, 08:00 (hora de Caracas)",
      null,
      "Fecha",
      expect.any(String),
      expect.any(String),
    ]);
    expect(sheet?.getCell("A1").font).toMatchObject({ bold: true });
    expect(sheet?.getRow(6).font).toMatchObject({ bold: true });
    // Las celdas de datos no cambian: mismos valores y tipos.
    expect(sheet?.getRow(7).values).toEqual([undefined, expect.any(String), 2, 10, 365, 300]);
    expect(sheet?.getRow(8).values).toEqual([undefined, expect.any(String), 1, 4, 146, 100]);
  });

  it("el kardex sin producto lo explica en el encabezado", async () => {
    const workbook = await build(emptyDataset);

    expect(columnA(workbook.getWorksheet("Kardex de producto")).slice(0, 4)).toEqual([
      "Kardex de producto",
      "Sin producto seleccionado",
      "Generado: 20/05/2026, 08:00 (hora de Caracas)",
      "Elige un producto en el reporte Kardex de producto para exportar sus movimientos.",
    ]);
  });

  it("sin imagen ninguna hoja lleva gráfico", async () => {
    const workbook = await build({ ...emptyDataset, dailySales }, viewFilters("daily-sales"));

    expect(workbook.worksheets.flatMap((worksheet) => worksheet.getImages())).toEqual([]);
  });

  it("pone el gráfico solo en la hoja del reporte abierto, entre el encabezado y la tabla", async () => {
    const workbook = await build(
      { ...emptyDataset, dailySales },
      viewFilters("daily-sales"),
      chartImage,
    );
    const sheet = workbook.getWorksheet("Ventas diarias");
    const images = sheet?.getImages() ?? [];

    expect(images).toHaveLength(1);
    expect(
      workbook.worksheets
        .filter((worksheet) => worksheet.name !== "Ventas diarias")
        .flatMap((worksheet) => worksheet.getImages()),
    ).toEqual([]);

    const image = images[0]!;
    const headerRow = headerRowNumber(sheet, "Fecha");

    // Anclada arriba a la izquierda con tamaño fijo: 720 × 360 px = 18 filas de 20 px.
    const { ext, tl } = image.range as unknown as {
      ext: { height: number; width: number };
      tl: { nativeCol: number; nativeRow: number };
    };

    expect(ext).toEqual({ height: 360, width: 720 });
    expect(tl.nativeCol).toBe(0);
    // Ancla en base 0: empieza bajo el título, las 4 líneas del encabezado y una fila en blanco…
    expect(tl.nativeRow).toBe(5);
    // …y termina antes de la fila de cabeceras de la tabla.
    expect(tl.nativeRow + Math.ceil(ext.height / 20)).toBeLessThan(headerRow - 1);
    expect(workbook.getImage(Number(image.imageId)).extension).toBe("png");
    // Los datos siguen completos debajo.
    expect(sheet?.getRow(headerRow + 1).values).toEqual([undefined, expect.any(String), 2, 10, 365, 300]);
    expect(sheet?.getRow(headerRow + 2).values).toEqual([undefined, expect.any(String), 1, 4, 146, 100]);
  });

  it("plataforma (sin reporte abierto) no pone imagen aunque llegue una", async () => {
    const workbook = await build({ ...emptyDataset, dailySales }, baseFilters, chartImage);

    expect(workbook.worksheets.flatMap((worksheet) => worksheet.getImages())).toEqual([]);
  });

  it("una imagen inservible no rompe el libro", async () => {
    const workbook = await build({ ...emptyDataset, dailySales }, viewFilters("daily-sales"), {
      dataUrl: "",
      height: 0,
      width: 0,
    });

    expect(workbook.worksheets).toHaveLength(reportCatalog.length);
    expect(workbook.getWorksheet("Ventas diarias")?.getImages()).toEqual([]);
  });

  it("el libro se abre en la hoja del reporte que estaba en pantalla", async () => {
    const workbook = await build(emptyDataset, viewFilters("purchases"));
    const purchasesIndex = reportCatalog.findIndex((report) => report.id === "purchases");

    expect(workbook.views[0]?.activeTab).toBe(purchasesIndex);
  });

  it("añade las hojas de la tienda activa, con nombres de hoja válidos y únicos", async () => {
    const workbook = await build(
      {
        ...emptyDataset,
        cashCloseDifferences: [],
        deadStock: [],
        payablesAging: [],
        receivablesAging: [],
        salesByCategory: [],
        salesByHour: [{ hour: 9, salesCount: 2, totalRef: 30, totalVes: 1095, weekday: "martes" }],
        stockAdjustments: [],
        stockTurnover: [],
      },
      viewFilters("sales-by-hour"),
    );
    const names = workbook.worksheets.map((worksheet) => worksheet.name);

    expect(names).toHaveLength(reportCatalog.length + 8);
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(names.length);
    expect(names.every((name) => name.length <= 31)).toBe(true);
    // «Ventas por hora y día de la semana» no cabe en 31 caracteres.
    const salesByHour = workbook.getWorksheet("Ventas por hora y día de la sem");

    expect(salesByHour?.getCell("A1").value).toBe("Ventas por hora y día de la semana");
    expect(salesByHour?.getRow(headerRowNumber(salesByHour, "Día") + 1).values).toEqual([
      undefined,
      "martes",
      "09:00",
      2,
      30,
      1095,
    ]);
  });

  it("recorta a 32.000 caracteres las celdas que Excel no admite", async () => {
    const longName = "x".repeat(40_000);
    const workbook = await build({
      ...emptyDataset,
      topCustomers: [{ customerId: "c1", name: longName, salesCount: 1, totalRef: 1, totalVes: 36 }],
    });
    const sheet = workbook.getWorksheet("Top clientes");
    const cell = sheet?.getRow(headerRowNumber(sheet, "Cliente") + 1).getCell(1).value;

    expect(String(cell)).toHaveLength(EXCEL_CELL_MAX_LENGTH);
    expect(String(cell).endsWith("…")).toBe(true);
  });

  it("una hoja cortada lo dice en su encabezado", async () => {
    const workbook = await build({
      ...emptyDataset,
      truncated: { purchases: { exported: 20_000, total: 53_210 } },
    });

    expect(columnA(workbook.getWorksheet("Compras"))).toContain(
      "Archivo cortado: esta hoja trae las primeras 20.000 filas de 53.210. Acota los filtros para exportar el resto.",
    );
  });
});
