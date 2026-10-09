/**
 * REP-F9: el error del resumen principal del dashboard no se enseña crudo. Solo
 * un error de negocio (`ClientApiError`) muestra su mensaje.
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ClientApiError } from "../../shared/api/apiFetch";

let mockSummaryError: Error | null = null;
const mockRefetch = jest.fn();

jest.mock("../../modules/dashboard/hooks/useDashboardKpiPeriod", () => ({
  useDashboardUrlPeriod: () => ({
    comparisonLabel: "vs ayer",
    currentFilters: {},
    kpiPeriodLabel: "Hoy",
    preset: "hoy",
    previousFilters: null,
    range: { from: "2026-05-18", preset: "today", to: "2026-05-18" },
    setRange: jest.fn(),
    today: "2026-05-18",
  }),
}));
jest.mock("../../modules/dashboard/hooks/useDashboard", () => {
  const query = () => ({
    data: undefined,
    error: mockSummaryError,
    isFetching: false,
    isLoading: false,
    refetch: mockRefetch,
  });

  return { useDashboardMetrics: query, useDashboardSummary: query };
});
jest.mock("../../modules/dashboard/components/DashboardPeriodField", () => ({
  DashboardPeriodField: () => null,
}));

import DashboardPage from "./page";

describe("DashboardPage · error del resumen principal (REP-F9)", () => {
  beforeEach(() => {
    mockSummaryError = null;
    mockRefetch.mockReset();
  });

  it("un error de negocio enseña su mensaje tal cual y deja reintentar", async () => {
    mockSummaryError = new ClientApiError(403, "FORBIDDEN", "No tienes permiso para ver el resumen.");
    render(<DashboardPage />);

    expect(screen.getByText("No pudimos cargar el dashboard")).toBeInTheDocument();
    expect(screen.getByText("No tienes permiso para ver el resumen.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(mockRefetch).toHaveBeenCalled();
  });

  it("cualquier otro error sale con el texto genérico, sin el mensaje interno", () => {
    mockSummaryError = new Error('Failed to fetch ["dashboard","summary"]');
    render(<DashboardPage />);

    expect(screen.getByText("No pudimos cargar el dashboard")).toBeInTheDocument();
    expect(screen.getByText("No pudimos cargar el resumen principal.")).toBeInTheDocument();
    expect(screen.queryByText(/Failed to fetch|summary/)).not.toBeInTheDocument();
  });
});
