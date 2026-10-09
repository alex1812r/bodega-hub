import { getActiveExportView, readReportsExportView } from "./reportExportView";

const viewer = { permissions: ["reports.view"] as const, role: "contador" as const };

function read(search: string) {
  return readReportsExportView(search, viewer);
}

describe("readReportsExportView (REP-08)", () => {
  it("sin parámetros es el reporte por defecto, sin comparar y con agrupación automática", () => {
    expect(read("")).toEqual({
      activeReportId: "daily-sales",
      bucket: undefined,
      categoryId: undefined,
      compare: false,
      contactId: undefined,
      currency: undefined,
      days: undefined,
      groupBy: undefined,
      purchasesStatus: undefined,
      turnoverGroupBy: undefined,
      viewer,
    });
  });

  it("lee de la URL el reporte abierto y sus filtros", () => {
    expect(
      read("?report=receivables-aging&bucket=30%2B&contactId=c-1&compare=1&groupBy=week"),
    ).toMatchObject({
      activeReportId: "receivables-aging",
      bucket: "30+",
      compare: true,
      contactId: "c-1",
      groupBy: "week",
    });
    expect(read("?report=cash-close-differences&currency=ref")).toMatchObject({
      activeReportId: "cash-close-differences",
      currency: "ref",
    });
    expect(read("?report=purchases&status=recibido")).toMatchObject({
      activeReportId: "purchases",
      purchasesStatus: "recibido",
    });
    expect(read("?status=all")).toMatchObject({ purchasesStatus: "all" });
  });

  it("lee días, categoría y agrupación de la rotación", () => {
    expect(read("?days=90&categoryId=cat-1&turnoverBy=category")).toMatchObject({
      categoryId: "cat-1",
      days: 90,
      turnoverGroupBy: "category",
    });
  });

  it("ignora lo que no es válido en lugar de fallar", () => {
    expect(
      read(
        `?report=no-existe&bucket=99&compare=si&groupBy=year&currency=eur&status=borrado&days=0&turnoverBy=sku&categoryId=${"x".repeat(200)}`,
      ),
    ).toEqual(read(""));
    expect(read("?days=3651").days).toBeUndefined();
    expect(read("?days=1e3").days).toBeUndefined();
    expect(read("?days=-5").days).toBeUndefined();
    expect(read("?days=3650").days).toBe(3650);
  });
});

describe("getActiveExportView", () => {
  it("devuelve la vista solo para el reporte abierto", () => {
    const view = read("?report=dead-stock&days=60");

    expect(getActiveExportView(view, "dead-stock")).toBe(view);
    expect(getActiveExportView(view, "stock-turnover")).toBeUndefined();
    expect(getActiveExportView(undefined, "dead-stock")).toBeUndefined();
  });
});
