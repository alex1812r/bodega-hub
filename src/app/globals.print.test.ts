/**
 * @jest-environment node
 *
 * INT-05 (B4) · las reglas de impresión del ticket de 80 mm vivían sueltas en
 * `globals.css`: `@page { size: 80mm auto }` y `body * { visibility: hidden }`
 * se aplicaban a TODA la app, así que imprimir cualquier pantalla con el
 * navegador daba una página de 80 mm en blanco. Solo pueden actuar donde está
 * montado el recibo (`#sale-receipt-preview`).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** La página que tiene el recibo montado, con la especificidad de `html` / `body` / `body *`. */
const RECEIPT_HTML = "html:where(:has(#sale-receipt-preview))";
const RECEIPT_PAGE = ":where(html:has(#sale-receipt-preview))";

const css = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

/** Cuerpo de cada bloque `@media print { … }` de primer nivel. */
function printBlocks(source: string) {
  const blocks: string[] = [];
  const opener = /@media\s+print\s*\{/g;

  for (let match = opener.exec(source); match; match = opener.exec(source)) {
    let depth = 1;
    let index = opener.lastIndex;

    while (depth > 0 && index < source.length) {
      if (source[index] === "{") depth += 1;
      if (source[index] === "}") depth -= 1;
      index += 1;
    }

    blocks.push(source.slice(opener.lastIndex, index - 1));
  }

  return blocks;
}

/** Selectores de las reglas de primer nivel de un bloque (sin sus declaraciones). */
function topLevelSelectors(block: string) {
  const selectors: string[] = [];
  let depth = 0;
  let current = "";

  for (const char of block) {
    if (char === "{") {
      if (depth === 0) {
        selectors.push(...current.split(",").map((selector) => selector.trim().replace(/\s+/g, " ")));
      }

      depth += 1;
      current = "";
    } else if (char === "}") {
      depth -= 1;
      current = "";
    } else {
      current += char;
    }
  }

  return selectors.filter(Boolean);
}

describe("globals.css · impresión", () => {
  const selectors = printBlocks(css).flatMap(topLevelSelectors);

  it("tiene reglas de impresión para el recibo", () => {
    expect(selectors).toContain("#sale-receipt-preview");
  });

  it("no fija un tamaño de página global: `@page` no admite selector y afectaría a toda la app", () => {
    expect(css).not.toMatch(/@page\b/);
  });

  it("cada regla de impresión cuelga del recibo o de la página que lo tiene montado", () => {
    const unscoped = selectors.filter(
      (selector) =>
        selector !== RECEIPT_HTML &&
        !selector.startsWith(`${RECEIPT_PAGE} `) &&
        !selector.startsWith("#sale-receipt-preview") &&
        selector !== ".sale-detail-receipt-aside",
    );

    expect(unscoped).toEqual([]);
  });

  it("ocultar el resto de la pantalla y estrechar la hoja solo ocurre con el recibo montado", () => {
    expect(selectors).toContain(`${RECEIPT_PAGE} body *`);
    expect(selectors).toContain(RECEIPT_HTML);
    expect(selectors).toContain(`${RECEIPT_PAGE} body`);
    expect(selectors).not.toContain("body *");
    expect(selectors).not.toContain("html");
    expect(selectors).not.toContain("body");
  });
});
