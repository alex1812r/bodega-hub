/**
 * REP-F1 · contraste del calendario y los chips de `DateRangeField` en claro y
 * en oscuro. Los valores salen de `globals.css`, como en `chartTheme.test.ts`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DATE_RANGE_COLOR_CLASSES } from "./dateRangeTheme";

type Rgb = [number, number, number];
type Tokens = Map<string, string>;
type Theme = "claro" | "oscuro";

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
const TOKENS: Record<Theme, Tokens> = {
  claro: light,
  oscuro: new Map([...light, ...readTokens(".dark")]),
};

/**
 * Color que una lista de clases da a `property` en ese tema: la variante
 * `dark:` gana en oscuro. Solo admite utilidades de token (`bg-primary`).
 */
function classColor(classes: string, property: "bg" | "text", theme: Theme): Rgb {
  const names = classes.split(/\s+/);
  const prefix = `${property}-`;
  const base = names.find((name) => name.startsWith(prefix));
  const dark = names.find((name) => name.startsWith(`dark:${prefix}`))?.slice("dark:".length);
  const utility = (theme === "oscuro" ? dark : undefined) ?? base;
  const token = utility?.slice(prefix.length);
  const hex = token ? TOKENS[theme].get(token) : undefined;

  if (!hex) {
    throw new Error(`"${classes}" no da un ${property} de token en ${theme}`);
  }

  return [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16)) as Rgb;
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

const { popover, rangeBand, rangeDayText, selected } = DATE_RANGE_COLOR_CLASSES;

describe("dateRangeTheme", () => {
  it("lee los dos temas de globals.css", () => {
    expect(TOKENS.claro.get("primary")).toBeDefined();
    expect(TOKENS.oscuro.get("primary")).not.toBe(TOKENS.claro.get("primary"));
  });

  it("no tiene colores literales", () => {
    for (const classes of Object.values(DATE_RANGE_COLOR_CLASSES)) {
      expect(classes).not.toMatch(/#|rgb|hsl|\[/);
    }
  });

  describe.each<Theme>(["claro", "oscuro"])("tema %s", (theme) => {
    it("el día seleccionado y el chip activo cumplen AA (≥ 4,5:1)", () => {
      expect(
        contrast(classColor(selected, "text", theme), classColor(selected, "bg", theme)),
      ).toBeGreaterThanOrEqual(4.5);
    });

    it("los días dentro del rango cumplen AA sobre la banda", () => {
      expect(
        contrast(classColor(rangeDayText, "text", theme), classColor(rangeBand, "bg", theme)),
      ).toBeGreaterThanOrEqual(4.5);
    });

    it("la banda del rango se distingue del fondo del calendario (≥ 1,5:1)", () => {
      expect(
        contrast(classColor(rangeBand, "bg", theme), classColor(popover, "bg", theme)),
      ).toBeGreaterThanOrEqual(1.5);
    });

    it("el día seleccionado se distingue de la banda que lo rodea (≥ 1,5:1)", () => {
      expect(
        contrast(classColor(selected, "bg", theme), classColor(rangeBand, "bg", theme)),
      ).toBeGreaterThanOrEqual(1.5);
    });
  });
});
