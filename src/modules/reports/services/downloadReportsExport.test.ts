import { buildReportsExportPdf } from "./buildReportsExportPdf";
import { buildReportsExportWorkbook } from "./buildReportsExportWorkbook";
import {
  downloadReportsExcelFromDataset,
  downloadReportsPdfFromDataset,
  resolveExportFilenameFilters,
} from "./downloadReportsExport";
import type { ReportsExportDataset, ReportsExportFilters } from "./fetchReportsForExport";

// Los archivos de verdad se construyen y reabren en sus tests y en
// `reportsExport.integration.test.ts`; aquí interesa el nombre y qué se les pasa.
jest.mock("./buildReportsExportPdf", () => ({
  buildReportsExportPdf: jest.fn(() => ({ output: () => new Blob(["%PDF"]) })),
}));

jest.mock("./buildReportsExportWorkbook", () => ({
  buildReportsExportWorkbook: jest.fn(async () => new ArrayBuffer(8)),
}));

const dataset: ReportsExportDataset = {
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

const exportedAt = "2026-10-01T18:05:00.000Z";
const range = { from: "2026-09-01", to: "2026-09-30" };
const platformFilters: ReportsExportFilters = {
  dateFilters: range,
  purchasesFilters: range,
  scope: { pathPrefix: "/api/platform/reports" },
  stockCardFilters: {},
};

function storeFilters(activeReportId: string, dateFilters = range): ReportsExportFilters {
  return {
    dateFilters,
    purchasesFilters: dateFilters,
    stockCardFilters: {},
    view: { activeReportId, compare: false, viewer: { permissions: [], role: undefined } },
  };
}

describe("descarga de la exportación (REP-08)", () => {
  const downloads: Array<{ blob: Blob; filename: string }> = [];
  let pendingBlob: Blob | null = null;

  beforeAll(() => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: (blob: Blob) => {
        pendingBlob = blob;

        return "blob:reportes";
      },
    });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: () => undefined });
    jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function click(
      this: HTMLAnchorElement,
    ) {
      downloads.push({ blob: pendingBlob as Blob, filename: this.download });
    });
  });

  beforeEach(() => {
    downloads.length = 0;
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it("el PDF se llama como el reporte abierto y su rango", () => {
    downloadReportsPdfFromDataset(dataset, storeFilters("daily-sales"), exportedAt);

    expect(downloads).toHaveLength(1);
    expect(downloads[0]?.filename).toBe("ventas-diarias_2026-09-01_2026-09-30.pdf");
    expect(downloads[0]?.blob.size).toBeGreaterThan(0);
    // Sin imagen capturada se construye sin ella.
    expect(buildReportsExportPdf).toHaveBeenLastCalledWith(dataset, {
      chartImage: null,
      exportedAt,
      filters: storeFilters("daily-sales"),
    });
  });

  it("el Excel de plataforma es el libro completo: `reportes` y el rango", async () => {
    await downloadReportsExcelFromDataset(dataset, platformFilters, exportedAt);

    expect(downloads[0]?.filename).toBe("reportes_2026-09-01_2026-09-30.xlsx");
    expect(downloads[0]?.blob.type).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  });

  it("sin rango, el nombre lleva el día de Caracas en que se generó", async () => {
    await downloadReportsExcelFromDataset(dataset, storeFilters("low-stock", {} as typeof range), exportedAt);

    expect(downloads[0]?.filename).toBe("bajo-stock_2026-10-01.xlsx");
  });

  it("descarga también con la imagen del gráfico", async () => {
    const chartImage = {
      dataUrl:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      height: 480,
      width: 960,
    };

    downloadReportsPdfFromDataset(dataset, storeFilters("gross-profit"), exportedAt, chartImage);
    await downloadReportsExcelFromDataset(dataset, storeFilters("gross-profit"), exportedAt, chartImage);

    expect(downloads.map((download) => download.filename)).toEqual([
      "ganancia-bruta_2026-09-01_2026-09-30.pdf",
      "ganancia-bruta_2026-09-01_2026-09-30.xlsx",
    ]);

    const metadata = { chartImage, exportedAt, filters: storeFilters("gross-profit") };

    expect(buildReportsExportPdf).toHaveBeenLastCalledWith(dataset, metadata);
    expect(buildReportsExportWorkbook).toHaveBeenLastCalledWith(dataset, metadata);
  });
});

describe("resolveExportFilenameFilters", () => {
  it("usa el rango de compras cuando el global no trae fechas", () => {
    expect(
      resolveExportFilenameFilters({
        dateFilters: {},
        purchasesFilters: range,
        stockCardFilters: {},
      }),
    ).toEqual({ from: "2026-09-01", reportName: undefined, to: "2026-09-30" });
  });

  it("nombra el reporte abierto", () => {
    expect(resolveExportFilenameFilters(storeFilters("receivables-aging")).reportName).toBe(
      "Cuentas por cobrar",
    );
  });
});
