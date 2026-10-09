import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

import * as reportsHooks from "../../hooks/useReports";
import { reportCatalog, type ReportDefinition } from "../config/reportCatalog";
import { ReportsResultPanel } from "./ReportsResultPanel";

/**
 * INT-02 · B2 — punto de entrada de INV-05 en el reporte de stock bajo: el
 * botón «Crear compra con estos productos» (`RestockPurchaseButton`) en la
 * cabecera del reporte de la tienda.
 */

jest.mock("../../hooks/useReports", () => {
  const queryResult = () => ({
    data: { items: [], limit: 10, skip: 0, total: 35 },
    error: null,
    isFetching: false,
    isLoading: false,
    refetch: jest.fn(),
  });

  return {
    ...jest.requireActual("../../hooks/useReports"),
    useLowStockReport: jest.fn(queryResult),
    useTopProductsReport: jest.fn(queryResult),
  };
});

const mockCan = jest.fn((permission: string) => permission === "purchases.create");

jest.mock("../../../../shared/auth/usePermission", () => ({
  usePermission: () => ({ can: mockCan, isLoading: false, profile: null }),
}));

const platformScope: reportsHooks.ReportRequestScope = {
  enabled: true,
  pathPrefix: "/api/platform/reports",
  storeScope: "all",
};

function panel(id: ReportDefinition["id"], scope?: reportsHooks.ReportRequestScope) {
  const report = reportCatalog.find((item) => item.id === id);

  if (!report) {
    throw new Error(`Reporte ${id} no encontrado`);
  }

  return (
    <ReportsResultPanel
      dateFilters={{ from: "2026-01-01", to: "2026-01-31" }}
      purchasesFilters={{ from: "2026-01-01", to: "2026-01-31" }}
      report={report}
      scope={scope}
      stockCardFilters={{}}
    />
  );
}

const restockButton = () =>
  screen.queryByRole("button", { name: "Crear compra con estos productos" });

const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  // Escritorio: la paginación del reporte consulta el ancho de la pantalla.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      addEventListener: () => undefined,
      addListener: () => undefined,
      dispatchEvent: () => false,
      matches: true,
      media: query,
      onchange: null,
      removeEventListener: () => undefined,
      removeListener: () => undefined,
    }),
  });
  mockCan.mockImplementation((permission: string) => permission === "purchases.create");
});

afterAll(() => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
});

describe("ReportsResultPanel · reposición desde el reporte de stock bajo (INV-05)", () => {
  it("el reporte de stock bajo de la tienda ofrece «Crear compra con estos productos» en su cabecera", () => {
    render(panel("low-stock"));

    expect(screen.getByRole("heading", { name: /Resultados:/ })).toBeInTheDocument();
    expect(restockButton()).toBeInTheDocument();
  });

  it("sin permiso de crear compras el botón no existe", () => {
    mockCan.mockReturnValue(false);

    render(panel("low-stock"));

    expect(restockButton()).not.toBeInTheDocument();
  });

  it("los demás reportes no lo muestran", () => {
    render(panel("top-products"));

    expect(restockButton()).not.toBeInTheDocument();
  });

  it("en los reportes de plataforma (varias tiendas) no se ofrece: la compra es de UNA tienda", () => {
    render(panel("low-stock", platformScope));

    expect(restockButton()).not.toBeInTheDocument();
  });
});
