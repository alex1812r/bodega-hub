/**
 * @jest-environment node
 *
 * REP-F6 · exportación de reportes:
 * - el PDF mezclaba «19125» con «16.957,50» en la misma columna (los enteros
 *   salían sin formato): un solo formateador es-VE, por columna;
 * - en Excel los números siguen siendo números, con formato de celda;
 * - rótulos con tilde y los mismos nombres que la pantalla para los dos
 *   porcentajes de «Ventas y margen por categoría»;
 * - la imagen del gráfico no llevaba leyenda: una línea de texto bajo ella.
 */
import ExcelJS from "exceljs";

import { getRolePermissions } from "@/shared/auth/permissions";

import {
  dailyCloseExportColumns,
  dailySalesExportColumns,
  formatReportExportCell,
  salesByCategoryExportColumns,
} from "../utils/reportExportSheetColumns";
import { buildReportsExportPdf } from "./buildReportsExportPdf";
import { buildReportsExportWorkbook } from "./buildReportsExportWorkbook";
import { formatChartLegendLine, type ChartImage } from "./captureChartImage";
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

/** Las cifras del hallazgo: importes enteros junto a importes con decimales. */
const dailySales = [
  { paidVes: 10650, saleDate: "2026-05-02", salesCount: 1250, totalRef: 37.5, totalVes: 19125 },
  { paidVes: 16957.5, saleDate: "2026-05-03", salesCount: 3, totalRef: 240, totalVes: 122400 },
];

const exportedAt = "2026-05-20T12:00:00.000Z";
const filters: ReportsExportFilters = {
  dateFilters: { from: "2026-05-01", to: "2026-05-18" },
  purchasesFilters: {},
  stockCardFilters: {},
  view: {
    activeReportId: "daily-sales",
    compare: true,
    viewer: { permissions: getRolePermissions("admin"), role: "admin" },
  },
};

const chartImage: ChartImage = {
  dataUrl:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  height: 480,
  legend: ["Ventas", "Periodo anterior"],
  width: 960,
};

function dailyColumn(header: string) {
  const found = dailySalesExportColumns.find((item) => item.header === header);

  if (!found) {
    throw new Error(`Sin columna «${header}»`);
  }

  return found;
}

describe("formatReportExportCell · un solo formato numérico es-VE", () => {
  it("un importe lleva siempre miles y dos decimales, sea entero o no", () => {
    expect(dailySales.map((row) => formatReportExportCell(dailyColumn("Total VES"), row))).toEqual([
      "19.125,00",
      "122.400,00",
    ]);
    expect(dailySales.map((row) => formatReportExportCell(dailyColumn("Cobrado VES"), row))).toEqual([
      "10.650,00",
      "16.957,50",
    ]);
    expect(dailySales.map((row) => formatReportExportCell(dailyColumn("Total REF"), row))).toEqual([
      "37,50",
      "240,00",
    ]);
  });

  it("una cantidad lleva miles y no inventa decimales", () => {
    expect(dailySales.map((row) => formatReportExportCell(dailyColumn("Ventas"), row))).toEqual([
      "1.250",
      "3",
    ]);
  });

  it("el texto pasa tal cual", () => {
    const date = dailyColumn("Fecha");

    expect(formatReportExportCell(date, dailySales[0]!)).toBe(date.value(dailySales[0]!));
  });

  it("en «Cierre del día» los indicadores en REF o VES son importes y los conteos no", () => {
    const value = dailyCloseExportColumns[1]!;

    expect(formatReportExportCell(value, { metric: "Ventas", value: 1250 })).toBe("1.250");
    expect(formatReportExportCell(value, { metric: "Total VES", value: 19125 })).toBe("19.125,00");
    expect(formatReportExportCell(value, { metric: "Baúl REF", value: "N/D" })).toBe("N/D");
  });
});

describe("rótulos de la exportación", () => {
  it("«Ventas y margen por categoría» nombra sus dos porcentajes como la pantalla", () => {
    const headers = salesByCategoryExportColumns.map((item) => item.header);

    expect(headers).not.toContain("Margen %");
    expect(headers.slice(-2)).toEqual(["Ganancia sobre costo %", "Margen sobre venta %"]);

    const row = {
      categoryId: "c1",
      categoryName: "Plomería",
      costRef: 80,
      grossProfitRef: 20,
      marginPct: 20,
      markupPct: 25,
      revenueRef: 100,
      units: 4,
    } as Parameters<(typeof salesByCategoryExportColumns)[number]["value"]>[0];

    expect(salesByCategoryExportColumns.slice(-2).map((item) => item.value(row))).toEqual([25, 20]);
  });
});

describe("PDF y Excel", () => {
  function pdfText(image: ChartImage | null = null) {
    const pdf = buildReportsExportPdf(
      { ...emptyDataset, dailySales },
      { chartImage: image, exportedAt, filters },
    );

    return Buffer.from(new Uint8Array(pdf.output("arraybuffer"))).toString("latin1");
  }

  async function sheet(image: ChartImage | null = null) {
    const buffer = await buildReportsExportWorkbook(
      { ...emptyDataset, dailySales },
      { chartImage: image, exportedAt, filters },
    );
    const workbook = new ExcelJS.Workbook();

    await workbook.xlsx.load(buffer);

    return workbook.getWorksheet("Ventas diarias")!;
  }

  function rowNumberOf(worksheet: ExcelJS.Worksheet, firstCell: string) {
    let found = 0;

    worksheet.eachRow({ includeEmpty: true }, (row, number) => {
      if (row.getCell(1).value === firstCell) {
        found = number;
      }
    });

    return found;
  }

  it("el PDF escribe todas las cifras de una columna con el mismo formato", () => {
    const text = pdfText();

    for (const figure of ["19.125,00", "122.400,00", "10.650,00", "16.957,50", "37,50", "240,00", "1.250"]) {
      expect(text).toContain(`(${figure})`);
    }

    expect(text).not.toMatch(/\((19125|122400|10650)\)/);
  });

  it("el Excel conserva los números y les da formato de celda", async () => {
    const worksheet = await sheet();
    const first = worksheet.getRow(rowNumberOf(worksheet, "Fecha") + 1);

    expect(first.values).toEqual([undefined, expect.any(String), 1250, 37.5, 19125, 10650]);
    expect(first.getCell(2).numFmt).toBe("#,##0");
    expect([3, 4, 5].map((index) => first.getCell(index).numFmt)).toEqual([
      "#,##0.00",
      "#,##0.00",
      "#,##0.00",
    ]);
  });

  it("la leyenda del gráfico va en una línea de texto bajo la imagen", async () => {
    const line = formatChartLegendLine(chartImage.legend);

    expect(line).toBe("Series: Ventas (línea continua) · Periodo anterior (línea discontinua)");
    expect(pdfText(chartImage)).toContain(
      "(Series: Ventas \\(l\xednea continua\\) \xb7 Periodo anterior \\(l\xednea discontinua\\))",
    );

    const worksheet = await sheet(chartImage);
    const legendRow = rowNumberOf(worksheet, line!);

    expect(legendRow).toBeGreaterThan(0);
    expect(legendRow).toBeLessThan(rowNumberOf(worksheet, "Fecha"));
  });

  it("con una sola serie no hay línea de leyenda", () => {
    expect(formatChartLegendLine(["Ventas"])).toBeUndefined();
    expect(formatChartLegendLine(undefined)).toBeUndefined();
    expect(pdfText({ ...chartImage, legend: ["Ventas"] })).not.toContain("(Series: ");
  });

  it("varias series sin periodo anterior se listan por su nombre", () => {
    expect(formatChartLegendLine(["Ventas", "Compras"])).toBe("Series: Ventas · Compras");
  });
});
