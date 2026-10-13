import {
  createProductSchema,
  keepProductPriceSchema,
  repriceProductsSchema,
  updateProductSchema,
} from "./productSchemas";

describe("sku del producto (PRO-05)", () => {
  const base = { name: "Harina PAN", salePriceRef: 2 };

  it.each([{}, { sku: "" }, { sku: "   " }])(
    "createProductSchema acepta el alta sin SKU (%j) y lo deja sin definir",
    (input) => {
      const result = createProductSchema.safeParse({ ...base, ...input });

      expect(result.success).toBe(true);
      expect(result.data?.sku).toBeUndefined();
    },
  );

  it("createProductSchema normaliza el SKU escrito", () => {
    expect(createProductSchema.parse({ ...base, sku: "  HAR-001 " }).sku).toBe("har-001");
  });

  it.each([123, null, ["har-001"], { value: "har-001" }])(
    "un SKU que no es texto (%j) se sigue rechazando en alta y en edición",
    (sku) => {
      expect(createProductSchema.safeParse({ ...base, sku }).success).toBe(false);
      expect(updateProductSchema.safeParse({ sku }).success).toBe(false);
    },
  );

  it.each([{}, { sku: "" }, { sku: "   " }])(
    "updateProductSchema deja el SKU vacío (%j) sin definir: se conserva el actual",
    (input) => {
      const result = updateProductSchema.safeParse({ name: "Harina", ...input });

      expect(result.success).toBe(true);
      expect(result.data?.sku).toBeUndefined();
    },
  );

  it("updateProductSchema normaliza el SKU escrito", () => {
    expect(updateProductSchema.parse({ sku: "  HAR-001 " }).sku).toBe("har-001");
  });
});

describe("updateProductSchema imageUrl", () => {
  it("accepts a valid image URL", () => {
    const result = updateProductSchema.safeParse({
      imageUrl: "https://example.supabase.co/storage/v1/object/public/product-images/prod-1/cover.webp",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.imageUrl).toBe(
        "https://example.supabase.co/storage/v1/object/public/product-images/prod-1/cover.webp",
      );
    }
  });

  it("accepts null to clear image", () => {
    const result = updateProductSchema.safeParse({
      imageUrl: null,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.imageUrl).toBeNull();
    }
  });
});

describe("updateProductSchema currentStock", () => {
  it("rejects currentStock so the edit form cannot overwrite sold stock", () => {
    const result = updateProductSchema.safeParse({ currentStock: 12, name: "Arroz" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["currentStock"]);
      expect(result.error.issues[0]?.message).toContain("ajuste de inventario");
    }
  });

  it("still accepts an update without stock", () => {
    const result = updateProductSchema.safeParse({ minStock: 4, name: "Arroz" });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("currentStock");
    }
  });
});

describe("keepProductPriceSchema", () => {
  it.each([[{}], [{ reason: null }], [{ reason: "   " }]])("leaves the reason null for %p", (input) => {
    expect(keepProductPriceSchema.parse(input)).toEqual({ reason: null });
  });

  it("trims the reason and rejects more than 200 characters", () => {
    expect(keepProductPriceSchema.parse({ reason: "  Lo reviso el lunes " })).toEqual({
      reason: "Lo reviso el lunes",
    });
    expect(keepProductPriceSchema.safeParse({ reason: "x".repeat(201) }).success).toBe(false);
  });
});

describe("repriceProductsSchema", () => {
  const ids = (count: number) => Array.from({ length: count }, (_, index) => `prod-${index}`);

  it("accepts 1 to 100 products and a % above 0 up to 1000", () => {
    expect(repriceProductsSchema.parse({ markupPct: 25, productIds: ["prod-1"] })).toEqual({
      markupPct: 25,
      productIds: ["prod-1"],
      reason: null,
    });
    expect(repriceProductsSchema.safeParse({ markupPct: 0.01, productIds: ids(100) }).success).toBe(true);
    expect(repriceProductsSchema.safeParse({ markupPct: 1000, productIds: ids(1) }).success).toBe(true);
  });

  it.each([
    ["no products", { markupPct: 25, productIds: [] }],
    ["101 products", { markupPct: 25, productIds: ids(101) }],
    ["a blank id", { markupPct: 25, productIds: ["  "] }],
    ["% 0", { markupPct: 0, productIds: ids(1) }],
    ["negative %", { markupPct: -1, productIds: ids(1) }],
    ["% above the cap", { markupPct: 1000.01, productIds: ids(1) }],
    ["NaN", { markupPct: Number.NaN, productIds: ids(1) }],
    ["Infinity", { markupPct: Number.POSITIVE_INFINITY, productIds: ids(1) }],
    ["a missing %", { productIds: ids(1) }],
  ])("rejects %s", (_name, input) => {
    expect(repriceProductsSchema.safeParse(input).success).toBe(false);
  });
});
