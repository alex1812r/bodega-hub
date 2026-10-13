/**
 * REP-F9: si la consulta del cierre del día falla (o queda en pausa sin red) el
 * panel no se queda en «Cargando cierre del día…»: pinta el error del tema con
 * «Reintentar». Solo un error de negocio enseña su mensaje.
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ClientApiError } from "@/shared/api/apiFetch";

import { DailyCloseReportPanel } from "./DailyCloseReportPanel";

type QueryState = {
  data?: unknown;
  error?: Error | null;
  isFetching?: boolean;
  isLoading?: boolean;
  isPaused?: boolean;
};

let mockQuery: QueryState = {};
const mockRefetch = jest.fn();

jest.mock("../../hooks/useReports", () => ({
  useDailyCloseReport: () => ({
    data: undefined,
    error: null,
    isFetching: false,
    isLoading: false,
    isPaused: false,
    refetch: mockRefetch,
    ...mockQuery,
  }),
}));

const LOADING_TEXT = "Cargando cierre del día…";

describe("DailyCloseReportPanel · error de la consulta (REP-F9)", () => {
  beforeEach(() => {
    mockQuery = {};
    mockRefetch.mockReset();
  });

  it("mientras carga sigue diciendo que está cargando", () => {
    mockQuery = { isFetching: true, isLoading: true };
    render(<DailyCloseReportPanel dateFilters={{}} />);

    expect(screen.getByText(LOADING_TEXT)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();
  });

  it("un error de negocio enseña su mensaje tal cual y deja reintentar", async () => {
    mockQuery = { error: new ClientApiError(422, "VALIDATION", "El rango de fechas no es válido.") };
    render(<DailyCloseReportPanel dateFilters={{}} />);

    expect(screen.queryByText(LOADING_TEXT)).not.toBeInTheDocument();
    expect(screen.getByText("El rango de fechas no es válido.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("cualquier otro error sale con el texto genérico, sin el mensaje interno", () => {
    mockQuery = { error: new Error('No QueryClient set ["reports","daily-close"]') };
    render(<DailyCloseReportPanel dateFilters={{}} />);

    expect(screen.queryByText(LOADING_TEXT)).not.toBeInTheDocument();
    expect(screen.getByText("No pudimos cargar el reporte.")).toBeInTheDocument();
    expect(screen.queryByText(/QueryClient|daily-close/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it("sin red (consulta en pausa) avisa de que no hay conexión", () => {
    mockQuery = { isPaused: true };
    render(<DailyCloseReportPanel dateFilters={{}} />);

    expect(screen.queryByText(LOADING_TEXT)).not.toBeInTheDocument();
    expect(screen.getByText("Sin conexión. Reintentaremos al volver la red.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it("al reintentar vuelve a «cargando» mientras llega la respuesta", () => {
    mockQuery = { error: new Error("boom"), isFetching: true };
    render(<DailyCloseReportPanel dateFilters={{}} />);

    expect(screen.getByText(LOADING_TEXT)).toBeInTheDocument();
  });
});
