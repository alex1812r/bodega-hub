/**
 * REP-F8 · R-07: la captura del gráfico espera a que termine de cargar (plazo
 * acotado) y dice por qué falta la imagen cuando el reporte debería llevarla.
 */
import { captureChartImage, CHART_SVG_SELECTOR } from "./captureChartImage";
import {
  captureChartImageWhenReady,
  CHART_SECTION_SELECTOR,
  CHART_WAIT_TIMEOUT_MS,
  readChartCaptureState,
} from "./captureChartImageWhenReady";

jest.mock("./captureChartImage", () => ({
  ...jest.requireActual("./captureChartImage"),
  captureChartImage: jest.fn(),
}));

const captureMock = jest.mocked(captureChartImage);
const image = { dataUrl: "data:image/png;base64,AAAA", height: 480, width: 960 };

const LOADING = '<div role="status" aria-label="Cargando Ventas diarias"></div>';
const DRAWN = '<div role="img" aria-label="Ventas diarias"><svg class="recharts-surface"></svg></div>';

function mountChart(inner: string) {
  document.body.innerHTML = `<section aria-label="Gráfico: Ventas diarias">${inner}</section>`;

  return document.querySelector("section") as HTMLElement;
}

describe("captureChartImageWhenReady (REP-F8 R-07)", () => {
  beforeEach(() => {
    captureMock.mockReset().mockResolvedValue(image);
    document.body.innerHTML = "";
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("usa el mismo marco que el selector de captura", () => {
    expect(CHART_SVG_SELECTOR.startsWith(`${CHART_SECTION_SELECTOR} `)).toBe(true);
  });

  it("distingue sin gráfico, cargando y dibujado", () => {
    expect(readChartCaptureState()).toBe("none");

    mountChart(LOADING);
    expect(readChartCaptureState()).toBe("loading");

    // Contenedor montado y recharts aún sin dibujar.
    mountChart('<div role="img" aria-label="Ventas diarias"></div>');
    expect(readChartCaptureState()).toBe("loading");

    mountChart(DRAWN);
    expect(readChartCaptureState()).toBe("ready");

    // Estado vacío o mapa de calor: no hay imagen que esperar.
    mountChart("<p>Sin datos en este periodo</p>");
    expect(readChartCaptureState()).toBe("none");
  });

  it("con el gráfico cargando espera a que aparezca antes de capturar", async () => {
    const section = mountChart(LOADING);
    const pending = captureChartImageWhenReady();

    await Promise.resolve();
    expect(captureMock).not.toHaveBeenCalled();

    section.innerHTML = DRAWN;

    await expect(pending).resolves.toEqual({ image, missing: null });
    expect(captureMock).toHaveBeenCalledTimes(1);
  });

  it("si vence el plazo y sigue cargando, no captura y lo dice", async () => {
    jest.useFakeTimers();
    mountChart(LOADING);

    const pending = captureChartImageWhenReady();

    jest.advanceTimersByTime(CHART_WAIT_TIMEOUT_MS);

    await expect(pending).resolves.toEqual({ image: null, missing: "loading" });
    expect(captureMock).not.toHaveBeenCalled();
  });

  it("con plazo 0 no espera: lee el estado del momento", async () => {
    mountChart(LOADING);

    await expect(captureChartImageWhenReady({ timeoutMs: 0 })).resolves.toEqual({
      image: null,
      missing: "loading",
    });
  });

  it("gráfico dibujado que no se puede capturar: falta por fallo, no por carga", async () => {
    captureMock.mockResolvedValue(null);
    mountChart(DRAWN);

    await expect(captureChartImageWhenReady()).resolves.toEqual({ image: null, missing: "failed" });
  });

  it("reporte sin gráfico: sin imagen y sin aviso", async () => {
    captureMock.mockResolvedValue(null);
    mountChart("<p>Sin datos en este periodo</p>");

    await expect(captureChartImageWhenReady()).resolves.toEqual({ image: null, missing: null });
  });

  it("si el gráfico termina en vacío mientras se espera, no queda colgado", async () => {
    captureMock.mockResolvedValue(null);
    const section = mountChart(LOADING);
    const pending = captureChartImageWhenReady();

    section.innerHTML = "<p>Sin datos en este periodo</p>";

    await expect(pending).resolves.toEqual({ image: null, missing: null });
  });
});
