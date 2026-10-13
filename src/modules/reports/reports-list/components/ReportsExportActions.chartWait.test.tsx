/**
 * REP-F8 · R-07: exportar mientras el gráfico carga. La vista previa espera a
 * que el gráfico aparezca antes de capturarlo; si no llega a tiempo, el modal
 * recibe el aviso y una forma de reintentar la captura.
 */
import "@testing-library/jest-dom";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ClientApiError } from "@/shared/api/apiFetch";

import { captureChartImage, type ChartImage } from "../../services/captureChartImage";
import { CHART_WAIT_TIMEOUT_MS } from "../../services/captureChartImageWhenReady";
import {
  fetchReportsForExport,
  type ReportsExportDataset,
  type ReportsExportFilters,
} from "../../services/fetchReportsForExport";
import { ReportsExportActions } from "./ReportsExportActions";

jest.mock("../../../../shared/auth/usePermission", () => ({
  usePermission: () => ({ permissions: ["reports.view"], role: "admin" }),
}));

jest.mock("../../services/fetchReportsForExport", () => ({
  fetchReportsForExport: jest.fn(),
}));

jest.mock("../../services/captureChartImage", () => ({
  ...jest.requireActual("../../services/captureChartImage"),
  captureChartImage: jest.fn(),
}));

type ModalProps = {
  chartImage: ChartImage | null;
  chartNotice?: string | null;
  onOpenChange: (open: boolean) => void;
  onRetryChartCapture?: () => Promise<ChartImage | null>;
  open: boolean;
};

const modalProps: ModalProps[] = [];

jest.mock("./ReportsExportPreviewModal", () => ({
  ReportsExportPreviewModal: (props: ModalProps) => {
    modalProps.push(props);

    return props.open ? <div role="dialog">{props.chartNotice}</div> : null;
  },
}));

const fetchMock = jest.mocked(fetchReportsForExport);
const captureMock = jest.mocked(captureChartImage);
const chartImage = { dataUrl: "data:image/png;base64,AAAA", height: 480, width: 960 };
const filters: ReportsExportFilters = {
  dateFilters: { from: "2026-09-01", to: "2026-09-30" },
  purchasesFilters: { from: "2026-09-01", to: "2026-09-30" },
  stockCardFilters: {},
};
const LOADING = '<div role="status" aria-label="Cargando Ventas diarias"></div>';
const DRAWN = '<div role="img" aria-label="Ventas diarias"><svg class="recharts-surface"></svg></div>';

function lastModalProps() {
  return modalProps[modalProps.length - 1]!;
}

/** El gráfico del reporte abierto, fuera del árbol del botón (como en la página). */
function mountChart(inner: string) {
  const section = document.createElement("section");

  section.setAttribute("aria-label", "Gráfico: Ventas diarias");
  section.innerHTML = inner;
  document.body.append(section);

  return section;
}

describe("ReportsExportActions · exportar con el gráfico cargando (REP-F8 R-07)", () => {
  let chart: HTMLElement | null = null;

  beforeEach(() => {
    modalProps.length = 0;
    fetchMock.mockReset().mockResolvedValue({ dailySales: [] } as unknown as ReportsExportDataset);
    captureMock.mockReset().mockResolvedValue(chartImage);
    window.history.replaceState(null, "", "/reports");
  });

  afterEach(() => {
    jest.useRealTimers();
    chart?.remove();
    chart = null;
  });

  it("espera a que el gráfico termine de cargar y lo captura", async () => {
    chart = mountChart(LOADING);
    const user = userEvent.setup();
    render(<ReportsExportActions exportFilters={filters} />);

    await user.click(screen.getByRole("button", { name: "Vista previa / exportar" }));

    // Los datos ya llegaron, pero la vista previa espera al gráfico.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(captureMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    act(() => {
      chart!.innerHTML = DRAWN;
    });

    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(captureMock).toHaveBeenCalledTimes(1);
    expect(lastModalProps().chartImage).toBe(chartImage);
    expect(lastModalProps().chartNotice ?? null).toBeNull();
  });

  it("si el gráfico no llega a tiempo abre igual, con aviso y reintento de captura", async () => {
    jest.useFakeTimers();
    chart = mountChart(LOADING);
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<ReportsExportActions exportFilters={filters} />);

    await user.click(screen.getByRole("button", { name: "Vista previa / exportar" }));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(CHART_WAIT_TIMEOUT_MS);
    });

    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(captureMock).not.toHaveBeenCalled();
    expect(lastModalProps().chartImage).toBeNull();
    expect(lastModalProps().chartNotice).toBe("El gráfico no se incluirá: aún se estaba cargando.");

    // El gráfico termina de cargar con el modal abierto: «Reintentar captura» lo recoge.
    chart.innerHTML = DRAWN;

    let retried: ChartImage | null = null;

    await act(async () => {
      retried = await lastModalProps().onRetryChartCapture!();
    });

    expect(retried).toBe(chartImage);
    expect(lastModalProps().chartImage).toBe(chartImage);
    expect(lastModalProps().chartNotice ?? null).toBeNull();
  });

  it("gráfico dibujado que no se puede capturar: lo avisa", async () => {
    captureMock.mockResolvedValue(null);
    chart = mountChart(DRAWN);
    const user = userEvent.setup();
    render(<ReportsExportActions exportFilters={filters} />);

    await user.click(screen.getByRole("button", { name: "Vista previa / exportar" }));

    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(lastModalProps().chartNotice).toBe(
      "El gráfico no se incluirá: no se pudo capturar la imagen.",
    );
  });

  it("reporte sin gráfico: sin aviso", async () => {
    captureMock.mockResolvedValue(null);
    const user = userEvent.setup();
    render(<ReportsExportActions exportFilters={filters} />);

    await user.click(screen.getByRole("button", { name: "Vista previa / exportar" }));

    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(lastModalProps().chartNotice ?? null).toBeNull();
  });

  it("R-11: un fallo interno al generar la vista previa no enseña su mensaje; uno de negocio sí", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const user = userEvent.setup();
    render(<ReportsExportActions exportFilters={filters} />);

    await user.click(screen.getByRole("button", { name: "Vista previa / exportar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo generar la vista previa de reportes.",
    );

    fetchMock.mockRejectedValueOnce(
      new ClientApiError(403, "FORBIDDEN", "No tienes permiso para realizar esta acción."),
    );
    await user.click(screen.getByRole("button", { name: "Vista previa / exportar" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("No tienes permiso para realizar esta acción."),
    );
  });
});
