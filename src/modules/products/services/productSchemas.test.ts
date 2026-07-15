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
