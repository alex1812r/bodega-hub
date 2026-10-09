/**
 * Captura el gráfico del reporte abierto como PNG para el PDF y el Excel, sin
 * librerías: clona su `<svg>`, le deja los estilos en línea, lo serializa y lo
 * rasteriza con `Image` + `<canvas>`.
 *
 * Tema: el papel es blanco, así que la imagen sale SIEMPRE en claro aunque la
 * app esté en oscuro. Los colores de los gráficos son `var(--token)`; en vez de
 * copiar una tabla de colores, el clon se cuelga un instante (fuera de
 * pantalla, sin llegar a pintarse) de un contenedor que redeclara los tokens
 * con los valores de la regla `:root` de las hojas de estilo (los del tema
 * claro; `.dark` solo los pisa). El navegador resuelve ahí los colores y se
 * copian al clon. Así no se toca la clase del `<html>` ni parpadea la pantalla.
 *
 * Tamaño: ancho lógico fijo (`CHART_IMAGE_WIDTH`) con el `viewBox` del gráfico,
 * a 2x. Un gráfico de 358 px en un móvil no sale diminuto en el papel.
 *
 * Nunca lanza: sin gráfico, sin canvas o con un SVG que el navegador no deja
 * leer, devuelve `null` y el archivo se exporta sin imagen.
 */

/** PNG del gráfico; `width` y `height` en px lógicos (el PNG mide el doble). */
export type ChartImage = {
  dataUrl: string;
  height: number;
  width: number;
};

/** Ancho lógico de la imagen, en px, sea cual sea el ancho de la pantalla. */
export const CHART_IMAGE_WIDTH = 960;
/** Densidad del PNG. */
export const CHART_IMAGE_SCALE = 2;
/** El SVG más alto que se rasteriza: por encima, el canvas falla en móviles. */
const CHART_IMAGE_MAX_HEIGHT = 2400;
const CAPTURE_TIMEOUT_MS = 4000;
const PAPER_COLOR = "#ffffff";
const PNG_DATA_URL_PREFIX = "data:image/png";

/**
 * El `<svg>` del gráfico visible: `ReportChartCard` (`section` «Gráfico: …») →
 * contenedor `role="img"` de `TimeSeriesChart` (`svg.recharts-surface`) o de
 * `RankingBarChart` (`svg.ranking-bar-chart-surface`). El mapa de calor es una
 * tabla HTML, no un SVG: no casa y ese reporte sale sin imagen.
 */
export const CHART_SVG_SELECTOR = 'section[aria-label^="Gráfico: "] [role="img"] svg';

/** Colores: se leen del clon, en el ámbito claro. */
const PAINT_PROPERTIES = ["color", "fill", "stroke", "stop-color"] as const;
/** Forma y texto: se leen del gráfico real, que es donde tienen su contexto. */
const LAYOUT_PROPERTIES = [
  "display",
  "dominant-baseline",
  "fill-opacity",
  "font-family",
  "font-size",
  "font-style",
  "font-variant-numeric",
  "font-weight",
  "letter-spacing",
  "opacity",
  "paint-order",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-opacity",
  "stroke-width",
  "text-anchor",
  "visibility",
] as const;

type StyleReader = Pick<CSSStyleDeclaration, "getPropertyValue">;

type CanvasContextLike = {
  drawImage: (image: never, x: number, y: number, width: number, height: number) => void;
  fillRect: (x: number, y: number, width: number, height: number) => void;
  fillStyle: unknown;
};

type CanvasLike = {
  getContext: (contextId: "2d") => CanvasContextLike | null;
  height: number;
  toDataURL: (type: string) => string;
  width: number;
};

type ImageLike = {
  onerror: unknown;
  onload: unknown;
  src: string;
};

type MediaRuleLike = { media?: { mediaText: string } };

/** Dependencias del DOM, inyectables en los tests. */
export type CaptureChartDeps = {
  createCanvas: () => CanvasLike;
  createImage: () => ImageLike;
  document: Document;
  getComputedStyle: (element: Element) => StyleReader;
  matchMedia: (query: string) => boolean;
  serialize: (node: Node) => string;
  timeoutMs: number;
};

function browserDeps(): CaptureChartDeps {
  return {
    createCanvas: () => document.createElement("canvas") as unknown as CanvasLike,
    createImage: () => new Image(),
    document,
    getComputedStyle: (element) => window.getComputedStyle(element),
    matchMedia: (query) =>
      typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false,
    serialize: (node) => new XMLSerializer().serializeToString(node),
    timeoutMs: CAPTURE_TIMEOUT_MS,
  };
}

function isRootSelector(selectorText: string) {
  return selectorText.split(",").some((selector) => selector.trim() === ":root");
}

function collectFromRules(
  rules: ArrayLike<CSSRule>,
  matchMedia: (query: string) => boolean,
  tokens: Map<string, string>,
) {
  for (const rule of Array.from(rules)) {
    const styleRule = rule as Partial<CSSStyleRule>;

    if (typeof styleRule.selectorText === "string" && styleRule.style) {
      if (isRootSelector(styleRule.selectorText)) {
        for (const name of Array.from(styleRule.style)) {
          if (name.startsWith("--")) {
            tokens.set(name, styleRule.style.getPropertyValue(name).trim());
          }
        }
      }
      continue;
    }

    const nested = (rule as Partial<CSSGroupingRule>).cssRules;

    if (!nested) {
      continue;
    }

    // Solo `@media` trae `media`; `@layer` y `@supports` se recorren siempre.
    const mediaText = (rule as MediaRuleLike).media?.mediaText;

    // Un `@media` que no aplica ahora (impresión) o que depende del tema del
    // sistema no define el tema claro.
    if (
      mediaText !== undefined &&
      (mediaText.includes("prefers-color-scheme") || !matchMedia(mediaText))
    ) {
      continue;
    }

    collectFromRules(nested, matchMedia, tokens);
  }
}

/**
 * Tokens (`--nombre` → valor declarado) de las reglas `:root`: el tema claro.
 * Las hojas de otro origen no se pueden leer y se saltan.
 */
export function collectRootTokens(
  sheets: ArrayLike<Pick<CSSStyleSheet, "cssRules">>,
  matchMedia: (query: string) => boolean = () => true,
) {
  const tokens = new Map<string, string>();

  for (const sheet of Array.from(sheets)) {
    try {
      collectFromRules(sheet.cssRules, matchMedia, tokens);
    } catch {
      // Hoja de otro origen: `cssRules` lanza SecurityError.
    }
  }

  return tokens;
}

function isPositive(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Tamaño del dibujo: su `viewBox`; si no tiene, sus atributos o lo que ocupa. */
export function resolveSvgSize(svg: Element): { height: number; width: number } | null {
  const viewBox = (svg.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);

  if (viewBox.length === 4 && isPositive(viewBox[2]) && isPositive(viewBox[3])) {
    return { height: viewBox[3], width: viewBox[2] };
  }

  const width = Number(svg.getAttribute("width"));
  const height = Number(svg.getAttribute("height"));

  if (isPositive(width) && isPositive(height)) {
    return { height, width };
  }

  const box = svg.getBoundingClientRect();

  return isPositive(box.width) && isPositive(box.height)
    ? { height: box.height, width: box.width }
    : null;
}

type InlineStyle = { property: string; value: string };

function readStyles(style: StyleReader, properties: readonly string[]): InlineStyle[] {
  return properties.flatMap((property) => {
    const value = style.getPropertyValue(property).trim();

    return value === "" ? [] : [{ property, value }];
  });
}

/**
 * Clon del gráfico con los estilos en línea y los colores del tema claro, más
 * el color del papel. El clon pasa por el documento (fuera de pantalla) solo
 * durante la lectura: todo ocurre en la misma tarea, sin pintarse.
 */
export function cloneSvgWithLightStyles(svg: Element, deps: CaptureChartDeps) {
  const { document: doc } = deps;
  const clone = svg.cloneNode(true) as Element;
  const host = doc.createElement("div");
  const tokens = collectRootTokens(doc.styleSheets, deps.matchMedia);

  host.setAttribute("aria-hidden", "true");
  host.setAttribute("data-chart-export-scope", "light");
  host.style.cssText =
    "position:fixed;left:-100000px;top:0;pointer-events:none;color-scheme:light;";
  tokens.forEach((value, name) => host.style.setProperty(name, value));
  host.style.setProperty("color", "var(--on-surface)");
  host.style.setProperty("background-color", "var(--surface-container-lowest)");
  host.append(clone);
  doc.body.append(host);

  try {
    const sources = [svg, ...Array.from(svg.querySelectorAll("*"))];
    const targets = [clone, ...Array.from(clone.querySelectorAll("*"))];
    // Primero se lee todo y después se escribe: un solo recálculo de estilos.
    const styles = targets.map((target, index) => [
      ...readStyles(deps.getComputedStyle(sources[index] ?? target), LAYOUT_PROPERTIES),
      ...readStyles(deps.getComputedStyle(target), PAINT_PROPERTIES),
    ]);
    const background =
      deps.getComputedStyle(host).getPropertyValue("background-color").trim() || PAPER_COLOR;

    targets.forEach((target, index) => {
      const inline = (target as Element & ElementCSSInlineStyle).style;

      for (const { property, value } of styles[index] ?? []) {
        inline?.setProperty(property, value);
      }
    });

    return { background, clone };
  } finally {
    host.remove();
  }
}

function loadImage(deps: CaptureChartDeps, src: string) {
  return new Promise<ImageLike>((resolve, reject) => {
    const image = deps.createImage();
    const timer = setTimeout(() => reject(new Error("timeout")), deps.timeoutMs);

    image.onload = () => {
      clearTimeout(timer);
      resolve(image);
    };
    image.onerror = () => {
      clearTimeout(timer);
      reject(new Error("image"));
    };
    image.src = src;
  });
}

/**
 * PNG del gráfico que hay en `root` (por defecto, el documento), o `null` si no
 * hay gráfico o no se pudo capturar.
 */
export async function captureChartImage(
  options: { deps?: Partial<CaptureChartDeps>; root?: ParentNode } = {},
): Promise<ChartImage | null> {
  try {
    const deps = { ...browserDeps(), ...options.deps };
    const svg = (options.root ?? deps.document).querySelector(CHART_SVG_SELECTOR);
    const size = svg ? resolveSvgSize(svg) : null;

    if (!svg || !size) {
      return null;
    }

    const width = CHART_IMAGE_WIDTH;
    const height = Math.round((size.height * width) / size.width);

    if (height <= 0 || height > CHART_IMAGE_MAX_HEIGHT) {
      return null;
    }

    const { background, clone } = cloneSvgWithLightStyles(svg, deps);

    // `XMLSerializer` ya declara el espacio de nombres SVG del elemento raíz.
    clone.setAttribute("viewBox", clone.getAttribute("viewBox") ?? `0 0 ${size.width} ${size.height}`);
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));

    const image = await loadImage(
      deps,
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(deps.serialize(clone))}`,
    );
    const canvas = deps.createCanvas();
    const pixelWidth = width * CHART_IMAGE_SCALE;
    const pixelHeight = height * CHART_IMAGE_SCALE;

    canvas.width = pixelWidth;
    canvas.height = pixelHeight;

    const context = canvas.getContext("2d");

    if (!context) {
      return null;
    }

    context.fillStyle = background;
    context.fillRect(0, 0, pixelWidth, pixelHeight);
    context.drawImage(image as never, 0, 0, pixelWidth, pixelHeight);

    // Con un SVG «tainted» `toDataURL` lanza SecurityError: lo recoge el `catch`.
    const dataUrl = canvas.toDataURL("image/png");

    return dataUrl.startsWith(PNG_DATA_URL_PREFIX) ? { dataUrl, height, width } : null;
  } catch {
    return null;
  }
}
