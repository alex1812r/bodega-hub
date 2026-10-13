/**
 * REP-F10 · «Métodos de pago» y «Depreciación FX»:
 * - N-09: ante un error de la consulta enseñaban el texto sin «Reintentar».
 * - N-10: un 5xx no enseña el mensaje interno del servidor.
 * - N-11: una respuesta 200 con `data: null` dejaba el panel en blanco.
 * - N-06: el indicador de carga de «Métodos de pago» no lo reconocía la espera
 *   de captura del gráfico, así que exportar mientras cargaba daba un archivo
 *   sin gráfico y sin aviso.
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ClientApiError } from "@/shared/api/apiFetch";

import { readChartCaptureState } from "../../services/captureChartImageWhenReady";
import { FxDepreciationReportPanel } from "./FxDepreciationReportPanel";
import { PaymentMethodsReportPanel } from "./PaymentMethodsReportPanel";

type QueryState = {
  data?: unknown;
  error?: Error | null;
  isFetching?: boolean;
  isLoading?: boolean;
  isPaused?: boolean;
};

let mockQuery: QueryState = {};
const mockRefetch = jest.fn();

jest.mock("../../hooks/useReports", () => {
  const query = () => ({
    data: undefined,
    error: null,
    isFetching: false,
    isLoading: false,
    isPaused: false,
    refetch: mockRefetch,
    ...mockQuery,
  });

  return { useFxDepreciationReport: query, usePaymentMethodsReport: query };
});

const INTERNAL = 'relation "public.payments" does not exist';
const GENERIC = "No pudimos cargar el reporte.";
const RANGE = { from: "2026-05-01", to: "2026-05-18" };

const PANELS = [
  ["Métodos de pago", () => <PaymentMethodsReportPanel dateFilters={RANGE} />],
  ["Depreciación FX", () => <FxDepreciationReportPanel dateFilters={RANGE} />],
] as const;

describe.each(PANELS)("%s · error de la consulta (REP-F10)", (_name, renderPanel) => {
  beforeEach(() => {
    mockQuery = {};
    mockRefetch.mockReset();
  });

  it("un 5xx sale con el texto genérico y con «Reintentar» (N-09, N-10)", async () => {
    mockQuery = { error: new ClientApiError(500, "UNKNOWN_ERROR", INTERNAL) };
    render(renderPanel());

    expect(screen.getByText(GENERIC)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/public\.payments/);

    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("un error de negocio (4xx) enseña su mensaje y deja reintentar", () => {
    mockQuery = { error: new ClientApiError(400, "BAD_REQUEST", 'La fecha "desde" no es válida.') };
    render(renderPanel());

    expect(screen.getByText('La fecha "desde" no es válida.')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it("una respuesta 200 con data null no deja el panel en blanco (N-11)", () => {
    mockQuery = { data: null };
    render(renderPanel());

    expect(screen.getByText(GENERIC)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it("sin red avisa de que no hay conexión, una sola vez", () => {
    mockQuery = { isPaused: true };
    render(renderPanel());

    expect(screen.getAllByText("Sin conexión. Reintentaremos al volver la red.")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Reintentar" })).toHaveLength(1);
  });

  it("mientras carga no enseña error", () => {
    mockQuery = { isFetching: true, isLoading: true };
    render(renderPanel());

    expect(screen.queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();
  });
});

describe("Métodos de pago · señal de «gráfico cargando» (REP-F10 N-06)", () => {
  it("mientras carga, la espera de captura del exporte lo ve como «loading»", () => {
    mockQuery = { isFetching: true, isLoading: true };
    const { container } = render(<PaymentMethodsReportPanel dateFilters={RANGE} />);

    expect(readChartCaptureState(container)).toBe("loading");
  });

  it("con error o sin pagos no hay gráfico que esperar", () => {
    mockQuery = { error: new Error("boom") };
    const failed = render(<PaymentMethodsReportPanel dateFilters={RANGE} />);

    expect(readChartCaptureState(failed.container)).toBe("none");
    failed.unmount();

    mockQuery = { data: { items: [], summary: { paymentCount: 0, totalRef: 0, totalVes: 0 } } };
    const empty = render(<PaymentMethodsReportPanel dateFilters={RANGE} />);

    expect(readChartCaptureState(empty.container)).toBe("none");
  });
});
