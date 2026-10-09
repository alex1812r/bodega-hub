/**
 * @jest-environment node
 */

import { jsPDF } from "jspdf";

import { getRolePermissions } from "@/shared/auth/permissions";

import { reportCatalog } from "../reports-list/config/reportCatalog";
import { buildReportsExportPdf } from "./buildReportsExportPdf";
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

const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** Un PNG con transparencia son dos objetos en el PDF: la imagen y su máscara alfa. */
const OBJECTS_PER_IMAGE = 2;

const exportedAt = "2026-05-20T12:00:00.000Z";
const baseFilters: ReportsExportFilters = {
  dateFilters: { from: "2026-05-01", to: "2026-05-18" },
  purchasesFilters: {},
  stockCardFilters: {},
};

function viewFilters(activeReportId: string): ReportsExportFilters {
  return {
    ...baseFilters,
    view: {
      activeReportId,
      compare: true,
      viewer: { permissions: getRolePermissions("admin"), role: "admin" },
    },
  };
}

function chart(height: number): ChartImage {
  return { dataUrl: PNG_1X1, height, width: 960 };
}

function build(
  data: ReportsExportDataset,
  filters: ReportsExportFilters = baseFilters,
  chartImage: ChartImage | null = null,
) {
  const pdf = buildReportsExportPdf(data, { chartImage, exportedAt, filters });
  const bytes = new Uint8Array(pdf.output("arraybuffer"));

  return {
    header: String.fromCharCode(...bytes.slice(0, 4)),
    // Imágenes incrustadas en el archivo.
    images:
      (Buffer.from(bytes).toString("latin1").match(/\/Subtype \/Image/g) ?? []).length /
      OBJECTS_PER_IMAGE,
    pdf,
    text: Buffer.from(bytes).toString("latin1"),
  };
}

function dailySales(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    paidVes: 100,
    saleDate: `2026-05-${String((index % 28) + 1).padStart(2, "0")}`,
    salesCount: 1,
    storeId: `s${index}`,
    totalRef: 4,
    totalVes: 146,
  }));
}

describe("buildReportsExportPdf", () => {
  it("genera un PDF válido con una página por reporte", () => {
    const { header, images, pdf } = build(emptyDataset);

    expect(header).toBe("%PDF");
    expect(pdf.getNumberOfPages()).toBe(reportCatalog.length);
    expect(images).toBe(0);
  });

  it("el encabezado lleva reporte, rango, comparación y fecha de generación en hora de Caracas", () => {
    const { text } = build(emptyDataset, viewFilters("daily-sales"));

    expect(text).toContain("(Ventas diarias)");
    expect(text).toContain("(Periodo: del 1 may 2026 al 18 may 2026)");
    expect(text).toContain("(Agrupaci\xf3n: D\xeda)");
    expect(text).toContain("(Comparado con periodo anterior)");
    expect(text).toContain("(Generado: 20/05/2026, 08:00 \\(hora de Caracas\\))");
    expect(text).not.toMatch(/productId/i);
  });

  it("incrusta el gráfico una sola vez, en el reporte abierto, sin añadir páginas si cabe", () => {
    const { header, images, pdf } = build(
      { ...emptyDataset, dailySales: dailySales(5) },
      viewFilters("daily-sales"),
      chart(480),
    );

    expect(header).toBe("%PDF");
    expect(images).toBe(1);
    expect(pdf.getNumberOfPages()).toBe(reportCatalog.length);
  });

  it("sin reporte abierto (plataforma) no incrusta la imagen", () => {
    const { images, pdf } = build({ ...emptyDataset, dailySales: dailySales(5) }, baseFilters, chart(480));

    expect(images).toBe(0);
    expect(pdf.getNumberOfPages()).toBe(reportCatalog.length);
  });

  it("un gráfico más alto que la página se reduce para caber, conservando la proporción", () => {
    const addImage = jest.fn();
    const { pdf } = build(emptyDataset, viewFilters("top-products"), chart(2400));

    expect(pdf.getNumberOfPages()).toBeGreaterThanOrEqual(reportCatalog.length);

    // Las medidas con las que se dibuja: se espía una segunda construcción.
    const spy = jest
      // `addImage` es un plugin: vive en `jsPDF.API`, cuyo tipo no lo declara.
      .spyOn(jsPDF.API as unknown as { addImage: (...args: unknown[]) => unknown }, "addImage")
      .mockImplementation(function mockAddImage(this: unknown, ...args: unknown[]) {
        addImage(...args);

        return this;
      });

    build(emptyDataset, viewFilters("top-products"), chart(2400));
    build(emptyDataset, viewFilters("top-products"), chart(480));
    spy.mockRestore();

    const [, , tallX, tallY, tallWidth, tallHeight] = addImage.mock.calls[0] as number[];
    const [, , x, , width, height] = addImage.mock.calls[1] as number[];

    // 960 × 480 al ancho útil (182 mm) → 91 mm de alto, centrado en el margen.
    expect(x).toBeCloseTo(14);
    expect(width).toBeCloseTo(182);
    expect(height).toBeCloseTo(91);
    // 960 × 2400 no cabe a 182 mm: se encoge a la altura útil y se centra.
    expect(tallHeight / tallWidth).toBeCloseTo(2400 / 960);
    expect(tallY + tallHeight).toBeLessThanOrEqual(297 - 16 + 0.001);
    expect(tallWidth).toBeLessThan(182);
    expect(tallX).toBeCloseTo(14 + (182 - tallWidth) / 2);
  });

  it("si el gráfico no cabe bajo el encabezado, salta de página antes de dibujarlo", () => {
    // 960 × 1320 px son 250 mm: no cabe bajo el encabezado, sí en una página nueva con su tabla.
    const withChart = build(emptyDataset, viewFilters("top-products"), chart(1320));

    expect(withChart.images).toBe(1);
    expect(withChart.pdf.getNumberOfPages()).toBe(reportCatalog.length + 1);
  });

  it("una imagen que no se puede leer no impide exportar la tabla", () => {
    const { header, images, pdf } = build(
      { ...emptyDataset, dailySales: dailySales(3) },
      viewFilters("daily-sales"),
      { dataUrl: "data:image/png;base64,no-es-un-png", height: 480, width: 960 },
    );

    expect(header).toBe("%PDF");
    expect(images).toBe(0);
    expect(pdf.getNumberOfPages()).toBe(reportCatalog.length);
  });

  it("una tabla larga sigue paginando con el gráfico encima", () => {
    const { images, pdf } = build(
      { ...emptyDataset, dailySales: dailySales(120) },
      viewFilters("daily-sales"),
      chart(480),
    );

    expect(images).toBe(1);
    expect(pdf.getNumberOfPages()).toBeGreaterThan(reportCatalog.length);
  });

  it("añade las secciones de la tienda activa y avisa de una hoja cortada", () => {
    const { pdf, text } = build(
      {
        ...emptyDataset,
        deadStock: [],
        receivablesAging: [],
        truncated: { purchases: { exported: 20_000, total: 53_210 } },
      },
      viewFilters("daily-sales"),
    );

    expect(pdf.getNumberOfPages()).toBe(reportCatalog.length + 2);
    expect(text).toContain("(Cuentas por cobrar)");
    expect(text).toContain("(Productos sin movimiento)");
    expect(text).toContain("Archivo cortado: esta hoja trae las primeras 20.000 filas de 53.210.");
  });
});
