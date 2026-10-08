/**
 * @jest-environment node
 *
 * PRO-F10 · la búsqueda de productos con caracteres reservados de PostgREST o
 * comodines de LIKE, y el tope de largo del término.
 */

import {
  buildProductSearchOrFilter,
  matchesProductSearch,
  normalizeProductSearch,
  PRODUCT_SEARCH_MAX_LENGTH,
} from "./productSearch";

/** Los tres valores del filtro, separados como los separa PostgREST: por comas fuera de comillas. */
function splitOrFilter(filter: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;

  for (const char of filter) {
    if (char === '"') quoted = !quoted;

    if (char === "," && !quoted) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  return [...parts, current];
}

describe("buildProductSearchOrFilter · reserved characters (PRO-F10)", () => {
  it.each([
    ["Harina (1 kg) x", '"%Harina (1 kg) x%"'],
    ["Harina (1", '"%Harina (1%"'],
    ["arroz, 1kg", '"%arroz, 1kg%"'],
    ["1.5 L", '"%1.5 L%"'],
    ["talla:M", '"%talla:M%"'],
    ['tubo 1/2"', "%tubo 1/2_%"],
    ["a\\b", "%a_b%"],
    ["100%", "%100_%"],
    ["a*b", "%a_b%"],
    ["a_b", "%a_b%"],
  ])("keeps [%s] as one literal value per column", (search, value) => {
    const filter = buildProductSearchOrFilter(search);

    expect(filter).toBe(`name.ilike.${value},sku.ilike.${value},barcode.ilike.${value}`);
    expect(splitOrFilter(filter)).toHaveLength(3);
  });

  it("a term that tries to close the or and add a filter stays inside the quoted value", () => {
    const filter = buildProductSearchOrFilter(")),or(id.not.is.null");

    expect(splitOrFilter(filter)).toEqual([
      'name.ilike."%)),or(id.not.is.null%"',
      'sku.ilike."%)),or(id.not.is.null%"',
      'barcode.ilike."%)),or(id.not.is.null%"',
    ]);
  });

  it.each(['x"),or(id.not.is.null,name.ilike."', 'x\\"),or(id.not.is.null'])(
    "a quote or a backslash in the term cannot end the quoted value [%s]",
    (search) => {
      const filter = buildProductSearchOrFilter(search);
      const values = splitOrFilter(filter);

      expect(values).toHaveLength(3);
      expect(filter.match(/"/g)).toHaveLength(6);
      expect(filter).not.toContain("\\");
    },
  );

  it("leaves a plain term unquoted, as before", () => {
    expect(buildProductSearchOrFilter("  harina pan ")).toBe(
      "name.ilike.%harina pan%,sku.ilike.%harina pan%,barcode.ilike.%harina pan%",
    );
  });

  it("the mock search finds the same terms as plain substrings", () => {
    const product = { barcode: null, name: 'Harina (1 kg) x, 100% "extra" a\\b*', sku: "har_1" };

    for (const term of ["(1 kg) x", "x, 100%", '"extra"', "a\\b*", "har_1", ")"]) {
      expect(matchesProductSearch(product, term)).toBe(true);
    }
  });
});

describe("normalizeProductSearch (PRO-F10 · M6)", () => {
  it("cuts the term at the maximum length", () => {
    const term = normalizeProductSearch("a".repeat(10_000));

    expect(term).toHaveLength(PRODUCT_SEARCH_MAX_LENGTH);
    expect(PRODUCT_SEARCH_MAX_LENGTH).toBe(100);
  });

  it("does not split an emoji at the cut and drops control characters", () => {
    expect(normalizeProductSearch(`${"a".repeat(99)}🍕🍕`)).toBe(`${"a".repeat(99)}🍕`);
    expect(normalizeProductSearch("  har\u0000ina  ")).toBe("harina");
    expect(normalizeProductSearch(null)).toBe("");
  });

  it("the filter is built with the cut term", () => {
    expect(buildProductSearchOrFilter("a".repeat(10_000))).toBe(
      ["name", "sku", "barcode"].map((column) => `${column}.ilike.%${"a".repeat(100)}%`).join(","),
    );
  });
});
