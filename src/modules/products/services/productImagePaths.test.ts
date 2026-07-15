import {
  buildProductImagePublicUrl,
  extractProductImageStoragePath,
  getProductImageStoragePath,
} from "./productImagePaths";

describe("productImagePaths", () => {
  it("builds storage path per product and format", () => {
    expect(getProductImageStoragePath("prod-1")).toBe("prod-1/cover.webp");
    expect(getProductImageStoragePath("prod-1", "png")).toBe("prod-1/cover.png");
  });

  it("builds public URL from supabase base", () => {
    expect(
      buildProductImagePublicUrl(
        "https://example.supabase.co",
        "prod-1/cover.webp",
      ),
    ).toBe(
      "https://example.supabase.co/storage/v1/object/public/product-images/prod-1/cover.webp",
    );
  });

  it("extracts storage path from public URL", () => {
    expect(
      extractProductImageStoragePath(
        "https://example.supabase.co/storage/v1/object/public/product-images/prod-1/cover.webp",
      ),
    ).toBe("prod-1/cover.webp");
  });
});
