/**
 * REP-01 · la paleta de gráficos sale solo de tokens del tema y se lee en claro
 * y en oscuro. Los valores se toman de `globals.css`, no se copian aquí.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CHART_COLORS,
  CHART_MAX_SERIES,
  CHART_PREVIOUS_SERIES_STYLE,
  CHART_SERIES_COLORS,
  CHART_SERIES_STYLE,
  CHART_TOOLTIP_COLORS,
  getChartSeriesColor,
} from "./chartTheme";

type Rgb = [number, number, number];
type Tokens = Map<string, string>;

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

/** Tokens de todos los bloques con ese selector (`.dark` aparece más de una vez). */
function readTokens(selector: string): Tokens {
  const tokens: Tokens = new Map();
  const escaped = selector.replace(/[.:]/g, "\\$&");
  const blocks = css.matchAll(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`, "g"));

  for (const [, body] of blocks) {
    for (const [, name, value] of body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
      tokens.set(name, value);
    }
  }

  return tokens;
}

const light = readTokens(":root");
const dark: Tokens = new Map([...light, ...readTokens(".dark")]);

function hexToRgb(hex: string): Rgb {
  return [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16)) as Rgb;
}

function tokenRgb(tokens: Tokens, name: string): Rgb {
  const value = tokens.get(name);

  if (!value) {
    throw new Error(`El token --${name} no existe en globals.css`);
  }

  return hexToRgb(value);
}

/** Resuelve `var(--a)` con los tokens del tema. Cualquier otra cosa no es un token. */
function resolveColor(color: string, tokens: Tokens): Rgb {
  const plain = /^var\(--([\w-]+)\)$/.exec(color);

  if (!plain) {
    throw new Error(`Color que no sale de tokens: ${color}`);
  }

  return tokenRgb(tokens, plain[1]);
}

function luminance(rgb: Rgb) {
  const [red, green, blue] = rgb.map((channel) => {
    const value = channel / 255;

    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(first: Rgb, second: Rgb) {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);

  return (lighter + 0.05) / (darker + 0.05);
}

type Matrix = [Rgb, Rgb, Rgb];
type Lab = { a: number; b: number; lightness: number };

/**
 * Visión normal y las dos deficiencias rojo-verde (≈ 8 % de los hombres),
 * simuladas con las matrices de Machado, Oliveira y Fernandes (2009) para
 * severidad total, sobre sRGB lineal.
 */
const VISION: Record<"deuteranopia" | "normal" | "protanopia", Matrix> = {
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  normal: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
};

function toLinear(channel: number) {
  const value = channel / 255;

  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** Color tal como lo percibe esa visión, en CIELAB (D65). */
function toLab(rgb: Rgb, vision: Matrix): Lab {
  const linear = rgb.map(toLinear);
  const [red, green, blue] = vision.map((row) =>
    Math.min(1, Math.max(0, row[0] * linear[0] + row[1] * linear[1] + row[2] * linear[2])),
  );
  const pivot = (value: number) =>
    value > 216 / 24389 ? Math.cbrt(value) : ((24389 / 27) * value + 16) / 116;
  const x = pivot((0.4124564 * red + 0.3575761 * green + 0.1804375 * blue) / 0.95047);
  const y = pivot(0.2126729 * red + 0.7151522 * green + 0.072175 * blue);
  const z = pivot((0.0193339 * red + 0.119192 * green + 0.9503041 * blue) / 1.08883);

  return { a: 500 * (x - y), b: 200 * (y - z), lightness: 116 * y - 16 };
}

/** ΔE*ab (CIE76): distancia percibida entre dos colores. ≈ 2,3 es lo mínimo apreciable. */
function deltaE(first: Lab, second: Lab) {
  return Math.hypot(first.lightness - second.lightness, first.a - second.a, first.b - second.b);
}

/** Distancia solo de tono y saturación (plano a*b*), sin contar la luminosidad. */
function deltaChroma(first: Lab, second: Lab) {
  return Math.hypot(first.a - second.a, first.b - second.b);
}

function pairs<T>(items: T[]): [T, T][] {
  return items.flatMap((first, index) => items.slice(index + 1).map((second): [T, T] => [first, second]));
}

/**
 * Umbrales de separación entre series (hoy la paleta da 40 / 34 / 26 de mínimo):
 *
 * - `MIN_DELTA_E` = 30 con visión normal. Una línea de 2 px o una muestra de
 *   leyenda de 8 px se distingue peor que dos manchas grandes: se exige más de
 *   diez veces lo mínimo apreciable (2,3).
 * - `MIN_DELTA_CHROMA` = 25: las series se separan por tono, no solo por ser
 *   una más clara que otra (dos grises a ΔE 40 pasarían el primer umbral).
 * - `MIN_DELTA_E_CVD` = 20 con protanopia y deuteranopia: ahí el tono se
 *   aplana y la separación se apoya también en la luminosidad, así que basta
 *   una distancia total menor, pero todavía inconfundible.
 */
const MIN_DELTA_E = 30;
const MIN_DELTA_CHROMA = 25;
const MIN_DELTA_E_CVD = 20;

const THEMES: [string, Tokens][] = [
  ["claro", light],
  ["oscuro", dark],
];
const SURFACES = ["surface", "surface-container-lowest"];

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (value && typeof value === "object") {
    return Object.values(value).flatMap(collectStrings);
  }

  return [];
}

describe("chartTheme", () => {
  it("lee los dos temas de globals.css", () => {
    expect(light.get("primary")).toBeDefined();
    expect(dark.get("primary")).toBeDefined();
    expect(dark.get("surface")).not.toBe(light.get("surface"));
    expect(dark.get("on-surface-variant")).not.toBe(light.get("on-surface-variant"));
  });

  it("las 5 series son los tokens --chart-1 … --chart-5, en orden", () => {
    expect([...CHART_SERIES_COLORS]).toEqual([
      "var(--chart-1)",
      "var(--chart-2)",
      "var(--chart-3)",
      "var(--chart-4)",
      "var(--chart-5)",
    ]);
  });

  it("los tokens de serie existen en :root y en .dark, y son colores del tema", () => {
    const darkOnly = readTokens(".dark");

    for (const index of [1, 2, 3, 4, 5]) {
      expect(light.get(`chart-${index}`)).toBeDefined();
      expect(darkOnly.get(`chart-${index}`)).toBeDefined();
      expect(css).toContain(`--color-chart-${index}: var(--chart-${index});`);
    }
  });

  it("chartTheme.ts no mezcla colores: ni color-mix ni literales", () => {
    const source = readFileSync(join(process.cwd(), "src/shared/components/charts/chartTheme.ts"), "utf8");

    expect(source).not.toMatch(/color-mix|#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
  });

  it("no tiene ningún color literal: todo es var(--token)", () => {
    const colors = [
      ...CHART_SERIES_COLORS,
      ...collectStrings(CHART_COLORS),
      ...collectStrings(CHART_TOOLTIP_COLORS),
    ];

    for (const color of colors) {
      expect(color).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
      expect(() => resolveColor(color, light)).not.toThrow();
      expect(() => resolveColor(color, dark)).not.toThrow();
    }
  });

  it("ofrece al menos 5 series distintas", () => {
    expect(CHART_MAX_SERIES).toBeGreaterThanOrEqual(5);
    expect(new Set(CHART_SERIES_COLORS).size).toBe(CHART_SERIES_COLORS.length);
  });

  describe.each(THEMES)("tema %s", (_name, tokens) => {
    it.each(SURFACES)("cada serie llega a 3:1 sobre --%s", (surface) => {
      const background = tokenRgb(tokens, surface);

      for (const color of CHART_SERIES_COLORS) {
        expect(contrast(resolveColor(color, tokens), background)).toBeGreaterThanOrEqual(3);
      }
    });

    it("la serie 1 es el color de marca del tema", () => {
      expect(tokens.get("chart-1")).toBe(tokens.get("primary"));
    });

    it("las series se distinguen entre sí por tono, no solo por luminosidad", () => {
      const series = CHART_SERIES_COLORS.map((color) =>
        toLab(resolveColor(color, tokens), VISION.normal),
      );

      for (const [first, second] of pairs(series)) {
        expect(deltaE(first, second)).toBeGreaterThanOrEqual(MIN_DELTA_E);
        expect(deltaChroma(first, second)).toBeGreaterThanOrEqual(MIN_DELTA_CHROMA);
      }
    });

    it.each(["protanopia", "deuteranopia"] as const)(
      "las series se siguen distinguiendo con %s",
      (vision) => {
        const series = CHART_SERIES_COLORS.map((color) =>
          toLab(resolveColor(color, tokens), VISION[vision]),
        );

        for (const [first, second] of pairs(series)) {
          expect(deltaE(first, second)).toBeGreaterThanOrEqual(MIN_DELTA_E_CVD);
        }
      },
    );

    it("ninguna serie se confunde con el color de error", () => {
      const error = toLab(tokenRgb(tokens, "error"), VISION.normal);

      for (const color of CHART_SERIES_COLORS) {
        expect(deltaE(toLab(resolveColor(color, tokens), VISION.normal), error)).toBeGreaterThanOrEqual(
          MIN_DELTA_E,
        );
      }
    });

    it.each(SURFACES)("el texto de ejes, etiquetas y tooltip cumple AA sobre --%s", (surface) => {
      const background = tokenRgb(tokens, surface);
      const texts = [
        CHART_COLORS.axisText,
        CHART_COLORS.label,
        CHART_TOOLTIP_COLORS.text,
        CHART_TOOLTIP_COLORS.mutedText,
      ];

      for (const color of texts) {
        expect(contrast(resolveColor(color, tokens), background)).toBeGreaterThanOrEqual(4.5);
      }
    });
  });

  it("getChartSeriesColor recorre la paleta y la repite pasado el máximo", () => {
    expect(getChartSeriesColor(0)).toBe(CHART_SERIES_COLORS[0]);
    expect(getChartSeriesColor(4)).toBe(CHART_SERIES_COLORS[4]);
    expect(getChartSeriesColor(CHART_MAX_SERIES)).toBe(CHART_SERIES_COLORS[0]);
    expect(getChartSeriesColor(-1)).toBe(CHART_SERIES_COLORS[1]);
    expect(getChartSeriesColor(Number.NaN)).toBe(CHART_SERIES_COLORS[0]);
  });

  it("la serie del periodo anterior va discontinua, más fina y atenuada", () => {
    expect(CHART_PREVIOUS_SERIES_STYLE.strokeDasharray).toMatch(/^\d+ \d+$/);
    expect(CHART_PREVIOUS_SERIES_STYLE.strokeOpacity).toBeLessThan(1);
    expect(CHART_PREVIOUS_SERIES_STYLE.strokeWidth).toBeLessThan(CHART_SERIES_STYLE.strokeWidth);
  });

  it("el marcador de pico es mayor que el de un punto normal", () => {
    expect(CHART_SERIES_STYLE.peakDotRadius).toBeGreaterThan(CHART_SERIES_STYLE.dotRadius);
  });
});
