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

/** Resuelve `var(--a)` o `color-mix(in srgb, var(--a) N%, var(--b))` con los tokens del tema. */
function resolveColor(color: string, tokens: Tokens): Rgb {
  const plain = /^var\(--([\w-]+)\)$/.exec(color);

  if (plain) {
    return tokenRgb(tokens, plain[1]);
  }

  const mixed = /^color-mix\(in srgb, var\(--([\w-]+)\) (\d+)%, var\(--([\w-]+)\)\)$/.exec(color);

  if (!mixed) {
    throw new Error(`Color que no sale de tokens: ${color}`);
  }

  const first = tokenRgb(tokens, mixed[1]);
  const second = tokenRgb(tokens, mixed[3]);
  const weight = Number(mixed[2]) / 100;

  return first.map((channel, index) =>
    Math.round(channel * weight + second[index] * (1 - weight)),
  ) as Rgb;
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

function distance(first: Rgb, second: Rgb) {
  return Math.hypot(...first.map((channel, index) => channel - second[index]));
}

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

  it("no tiene ningún color literal: todo es var(--token) o mezcla de tokens", () => {
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

    it("las series se distinguen entre sí", () => {
      const resolved = CHART_SERIES_COLORS.map((color) => resolveColor(color, tokens));

      resolved.forEach((first, index) => {
        resolved.slice(index + 1).forEach((second) => {
          expect(distance(first, second)).toBeGreaterThanOrEqual(70);
        });
      });
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
