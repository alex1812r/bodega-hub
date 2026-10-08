import {
  CATEGORY_MARKUP_PCT_RANGE_MESSAGE,
  createCategorySchema,
  parseCategoryDefaultMarkupPct,
  updateCategorySchema,
} from "./categorySchemas";

describe("categorySchemas · % de ganancia sugerido", () => {
  it("es opcional en el alta y en la edición", () => {
    expect(createCategorySchema.parse({ name: "Bebidas" })).toEqual({ name: "Bebidas" });
    expect(updateCategorySchema.parse({})).toEqual({});
  });

  it.each([
    [0.01, 0.01],
    [35.5, 35.5],
    [1000, 1000],
    [12.345, 12.35],
  ])("acepta %p y lo guarda como %p (dos decimales)", (input, expected) => {
    expect(createCategorySchema.parse({ defaultMarkupPct: input, name: "Bebidas" }).defaultMarkupPct).toBe(expected);
    expect(updateCategorySchema.parse({ defaultMarkupPct: input }).defaultMarkupPct).toBe(expected);
  });

  it("acepta null (borra la sugerencia)", () => {
    expect(updateCategorySchema.parse({ defaultMarkupPct: null })).toEqual({ defaultMarkupPct: null });
    expect(createCategorySchema.parse({ defaultMarkupPct: null, name: "Bebidas" }).defaultMarkupPct).toBeNull();
  });

  it.each([0, -5, 1000.01, 0.004, Number.NaN, Number.POSITIVE_INFINITY, "20"])(
    "rechaza %p con el motivo en español",
    (defaultMarkupPct) => {
      const parsed = updateCategorySchema.safeParse({ defaultMarkupPct });

      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]?.message).toBe(CATEGORY_MARKUP_PCT_RANGE_MESSAGE);
    },
  );

  describe("parseCategoryDefaultMarkupPct", () => {
    it("distingue no enviado (undefined), borrar (null) y un valor", () => {
      expect(parseCategoryDefaultMarkupPct(undefined)).toBeUndefined();
      expect(parseCategoryDefaultMarkupPct(null)).toBeNull();
      expect(parseCategoryDefaultMarkupPct(20.555)).toBe(20.56);
    });

    it.each([0, -1, 1000.01, "20"])("responde 400 con %p", (value) => {
      expect(() => parseCategoryDefaultMarkupPct(value)).toThrow(
        expect.objectContaining({
          code: "BAD_REQUEST",
          message: CATEGORY_MARKUP_PCT_RANGE_MESSAGE,
          status: 400,
        }),
      );
    });
  });
});
