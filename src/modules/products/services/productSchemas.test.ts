import { updateProductSchema } from "./productSchemas";

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
