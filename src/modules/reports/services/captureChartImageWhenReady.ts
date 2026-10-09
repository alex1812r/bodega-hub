import { captureChartImage, type ChartImage } from "./captureChartImage";

/**
 * Marco del gráfico del reporte abierto (`ReportChartCard`). Es el mismo
 * arranque que `CHART_SVG_SELECTOR` de `captureChartImage`: una prueba vigila
 * que no se separen.
 */
export const CHART_SECTION_SELECTOR = 'section[aria-label^="Gráfico: "]';
/** El dibujo ya montado: contenedor `role="img"` con su `<svg>`. */
const CHART_CONTAINER_SELECTOR = '[role="img"]';
const CHART_SVG_IN_SECTION_SELECTOR = `${CHART_CONTAINER_SELECTOR} svg`;
/** Esqueleto de carga de `TimeSeriesChart`, `RankingBarChart` y `HeatmapChart`. */
const CHART_LOADING_SELECTOR = '[role="status"][aria-label^="Cargando "]';

/** Cuánto se espera, como mucho, a que el gráfico termine de cargar. */
export const CHART_WAIT_TIMEOUT_MS = 5000;

/**
 * - `none`: el reporte no tiene gráfico que capturar (solo tabla, mapa de
 *   calor, estado vacío o de error).
 * - `loading`: hay un gráfico en camino (esqueleto de carga, o contenedor
 *   montado y aún sin `<svg>`).
 * - `ready`: el `<svg>` está en el documento.
 */
export type ChartCaptureState = "loading" | "none" | "ready";

export function readChartCaptureState(root: ParentNode = document): ChartCaptureState {
  const section = root.querySelector(CHART_SECTION_SELECTOR);

  if (!section) {
    return "none";
  }

  if (section.querySelector(CHART_SVG_IN_SECTION_SELECTOR)) {
    return "ready";
  }

  return section.querySelector(CHART_LOADING_SELECTOR) || section.querySelector(CHART_CONTAINER_SELECTOR)
    ? "loading"
    : "none";
}

type WaitOptions = {
  root?: ParentNode;
  /** Plazo máximo; `0` = no esperar, solo leer el estado actual. */
  timeoutMs?: number;
};

/**
 * Espera a que el gráfico deje de estar cargando, observando el documento, con
 * un plazo acotado. Devuelve el estado final; si vence el plazo, `loading`.
 */
export function waitForChart({
  root = document,
  timeoutMs = CHART_WAIT_TIMEOUT_MS,
}: WaitOptions = {}): Promise<ChartCaptureState> {
  const initial = readChartCaptureState(root);

  if (initial !== "loading" || timeoutMs <= 0) {
    return Promise.resolve(initial);
  }

  return new Promise((resolve) => {
    const finish = () => {
      observer.disconnect();
      window.clearTimeout(timer);
      resolve(readChartCaptureState(root));
    };
    const observer = new MutationObserver(() => {
      if (readChartCaptureState(root) !== "loading") {
        finish();
      }
    });
    const timer = window.setTimeout(finish, timeoutMs);

    observer.observe(root instanceof Document ? root.documentElement : root, {
      attributes: true,
      childList: true,
      subtree: true,
    });
  });
}

export type ChartCapture = {
  image: ChartImage | null;
  /**
   * Por qué falta la imagen en un reporte que debería llevarla: el gráfico
   * seguía cargando al vencer el plazo, o estaba dibujado y no se pudo
   * capturar. `null` = hay imagen, o el reporte no tiene gráfico.
   */
  missing: "failed" | "loading" | null;
};

/**
 * Captura el gráfico del reporte abierto esperando antes a que termine de
 * cargar (REP-F8 R-07): exportar con el gráfico a medias daba un archivo sin
 * imagen y sin aviso. Nunca lanza.
 */
export async function captureChartImageWhenReady(options: WaitOptions = {}): Promise<ChartCapture> {
  const state = await waitForChart(options);

  if (state === "loading") {
    return { image: null, missing: "loading" };
  }

  const image = await captureChartImage(options.root ? { root: options.root } : undefined);

  return { image, missing: image === null && state === "ready" ? "failed" : null };
}
