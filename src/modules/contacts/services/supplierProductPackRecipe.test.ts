import { assertPackSizeMatchesRecipe, packRecipeMismatchMessage, resolvePackRecipeRule } from "./supplierProductPackRecipe";

describe("supplierProductPackRecipe", () => {
  it("prefers the component side, like create_purchase", () => {
    expect(resolvePackRecipeRule({ componentSizes: [12, 6, 12], packTotalUnits: 36 })).toEqual({
      kind: "component",
      sizes: [6, 12],
    });
    expect(resolvePackRecipeRule({ componentSizes: [], packTotalUnits: 36 })).toEqual({ kind: "pack", sizes: [36] });
    expect(resolvePackRecipeRule({ componentSizes: [0], packTotalUnits: null })).toBeNull();
  });

  it("accepts any size without recipe and only recipe sizes with one", () => {
    expect(() => assertPackSizeMatchesRecipe(null, 7)).not.toThrow();
    expect(() => assertPackSizeMatchesRecipe({ kind: "component", sizes: [6, 12] }, 12)).not.toThrow();
    expect(() => assertPackSizeMatchesRecipe({ kind: "component", sizes: [6, 12] }, 10)).toThrow(
      expect.objectContaining({ status: 400 }),
    );
  });

  it("writes the sizes list in Spanish", () => {
    expect(packRecipeMismatchMessage({ kind: "component", sizes: [6, 8] }, 10)).toBe(
      "Este producto se arma en empaques de 6 u 8 unidades; 10 no coincide con ninguna receta.",
    );
    expect(packRecipeMismatchMessage({ kind: "component", sizes: [6, 10, 12] }, 24)).toBe(
      "Este producto se arma en empaques de 6, 10 o 12 unidades; 24 no coincide con ninguna receta.",
    );
  });
});
