import { createProductSchema, updateProductSchema } from "./productSchemas";

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
