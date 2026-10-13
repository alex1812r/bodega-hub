/**
 * REP-F10 (N-05): cambiar de rango (o de reporte) mientras el botón dice
 * «Generando vista previa...» daba un archivo con las tablas del rango del clic
 * y la imagen del gráfico del rango nuevo, sin aviso. Los datos se piden con
 * los filtros del clic, pero el gráfico se captura hasta 5 s después de lo que
 * haya en pantalla. Si lo que se exporta cambió antes de terminar, la vista
 * previa se descarta y se pide generarla de nuevo.
 */
import "@testing-library/jest-dom";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { captureChartImage } from "../../services/captureChartImage";
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

type ModalProps = { filters: ReportsExportFilters; open: boolean };

const modalProps: ModalProps[] = [];

jest.mock("./ReportsExportPreviewModal", () => ({
  ReportsExportPreviewModal: (props: ModalProps) => {
    modalProps.push(props);

    return props.open ? <div role="dialog" /> : null;
  },
}));

const fetchMock = jest.mocked(fetchReportsForExport);
const captureMock = jest.mocked(captureChartImage);
const dataset = { dailySales: [] } as unknown as ReportsExportDataset;
const STALE_NOTICE = "Los filtros cambiaron mientras se generaba la vista previa. Vuelve a generarla.";
const LOADING = '<div role="status" aria-label="Cargando Ventas diarias"></div>';
const DRAWN = '<div role="img" aria-label="Ventas diarias"><svg class="recharts-surface"></svg></div>';

function filtersFor(from: string, to: string): ReportsExportFilters {
  return { dateFilters: { from, to }, purchasesFilters: { from, to }, stockCardFilters: {} };
}

const MAY_17_18 = filtersFor("2026-05-17", "2026-05-18");
const MAY_01_18 = filtersFor("2026-05-01", "2026-05-18");

function urlFor(filters: ReportsExportFilters) {
  return `/reports?report=daily-sales&from=${filters.dateFilters.from}&to=${filters.dateFilters.to}`;
}

/** Una respuesta de datos que el test resuelve cuando quiere. */
function deferredDataset() {
  let resolve!: (value: ReportsExportDataset) => void;
  const promise = new Promise<ReportsExportDataset>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

describe("ReportsExportActions · los filtros cambian mientras se genera la vista previa (REP-F10 N-05)", () => {
  let chart: HTMLElement | null = null;

  beforeEach(() => {
    modalProps.length = 0;
    fetchMock.mockReset().mockResolvedValue(dataset);
    captureMock.mockReset().mockResolvedValue({ dataUrl: "data:image/png;base64,AAAA", height: 480, width: 960 });
    window.history.replaceState(null, "", urlFor(MAY_17_18));
  });

  afterEach(() => {
    chart?.remove();
    chart = null;
  });

  it("cambiar de rango antes de que lleguen los datos: descarta la vista previa y lo avisa", async () => {
    const pending = deferredDataset();
    fetchMock.mockReturnValueOnce(pending.promise);
    const user = userEvent.setup();
    const { rerender } = render(<ReportsExportActions exportFilters={MAY_17_18} />);

    await user.click(screen.getByRole("button", { name: "Vista previa / exportar" }));
    expect(screen.getByRole("button", { name: "Generando vista previa..." })).toBeDisabled();

    // El usuario elige otro rango: cambian la URL y los filtros que recibe el botón.
    act(() => {
      window.history.replaceState(null, "", urlFor(MAY_01_18));
    });
    rerender(<ReportsExportActions exportFilters={MAY_01_18} />);

    await act(async () => {
      pending.resolve(dataset);
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(STALE_NOTICE);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(modalProps.every((props) => !props.open)).toBe(true);

    // Al generarla de nuevo sale entera con el rango nuevo.
    await user.click(screen.getByRole("button", { name: "Vista previa / exportar" }));

    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]![0].dateFilters).toEqual(MAY_01_18.dateFilters);
    expect(modalProps[modalProps.length - 1]!.filters.dateFilters).toEqual(MAY_01_18.dateFilters);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("cambiar la URL mientras se espera al gráfico: no mezcla las tablas de un rango con el gráfico de otro", async () => {
    chart = document.createElement("section");
    chart.setAttribute("aria-label", "Gráfico: Ventas diarias");
    chart.innerHTML = LOADING;
    document.body.append(chart);

    const user = userEvent.setup();
    render(<ReportsExportActions exportFilters={MAY_17_18} />);

    await user.click(screen.getByRole("button", { name: "Vista previa / exportar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Los datos del 17–18 ya llegaron; el gráfico que termina de cargar es el del 1–18.
    act(() => {
      window.history.replaceState(null, "", urlFor(MAY_01_18));
      chart!.innerHTML = DRAWN;
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(STALE_NOTICE);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Vista previa / exportar" })).toBeEnabled();
  });

  it("sin cambios, la vista previa abre con los filtros del clic", async () => {
    const user = userEvent.setup();
    render(<ReportsExportActions exportFilters={MAY_17_18} />);

    await user.click(screen.getByRole("button", { name: "Vista previa / exportar" }));

    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(modalProps[modalProps.length - 1]!.filters.dateFilters).toEqual(MAY_17_18.dateFilters);
  });

  it("un re-render con los mismos filtros (otro objeto) no descarta nada", async () => {
    const pending = deferredDataset();
    fetchMock.mockReturnValueOnce(pending.promise);
    const user = userEvent.setup();
    const { rerender } = render(<ReportsExportActions exportFilters={MAY_17_18} />);

    await user.click(screen.getByRole("button", { name: "Vista previa / exportar" }));
    rerender(<ReportsExportActions exportFilters={filtersFor("2026-05-17", "2026-05-18")} />);

    await act(async () => {
      pending.resolve(dataset);
    });

    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
