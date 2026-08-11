import {
  assertAllowedProductImageUrl,
  assertProductImagePublicUrlHost,
  buildProductImagePublicUrl,
  extractProductImageStoragePath,
  getAllowedProductImagePublicUrls,
  getProductImageStoragePath,
  resolveProductImagePublicUrlFromStorage,
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

  it("lists allowed public URLs for a product", () => {
    expect(getAllowedProductImagePublicUrls("https://example.supabase.co/", "prod-1")).toEqual([
      "https://example.supabase.co/storage/v1/object/public/product-images/prod-1/cover.webp",
      "https://example.supabase.co/storage/v1/object/public/product-images/prod-1/cover.png",
    ]);
  });

  it("rejects public URL with a different host", () => {
    expect(() =>
      assertProductImagePublicUrlHost(
        "https://mqxvxhstrxnbyydtwgqh.supabase.co",
        "https://other.supabase.co/storage/v1/object/public/product-images/prod-1/cover.png",
      ),
    ).toThrow(/Host de imagen distinto/);
  });

  it("accepts matching host and cover path", () => {
    expect(() =>
      assertAllowedProductImageUrl(
        "https://mqxvxhstrxnbyydtwgqh.supabase.co",
        "288d1880-89db-4e55-90c3-6f8fcbaa6c0b",
        "https://mqxvxhstrxnbyydtwgqh.supabase.co/storage/v1/object/public/product-images/288d1880-89db-4e55-90c3-6f8fcbaa6c0b/cover.png",
      ),
    ).not.toThrow();
  });

  it("rejects cover path for another product id", () => {
    expect(() =>
      assertAllowedProductImageUrl(
        "https://mqxvxhstrxnbyydtwgqh.supabase.co",
        "prod-1",
        "https://mqxvxhstrxnbyydtwgqh.supabase.co/storage/v1/object/public/product-images/prod-2/cover.webp",
      ),
    ).toThrow(/imageUrl debe ser/);
  });

  it("resolves getPublicUrl and checks it matches the expected URL", () => {
    const path = "prod-1/cover.png";
    const publicUrl = buildProductImagePublicUrl("https://example.supabase.co", path);

    expect(
      resolveProductImagePublicUrlFromStorage({
        getPublicUrl: () => ({ data: { publicUrl } }),
        path,
        supabaseUrl: "https://example.supabase.co",
      }),
    ).toBe(publicUrl);
  });

  it("throws when getPublicUrl host diverges from env", () => {
    expect(() =>
      resolveProductImagePublicUrlFromStorage({
        getPublicUrl: () => ({
          data: {
            publicUrl:
              "https://other.supabase.co/storage/v1/object/public/product-images/prod-1/cover.webp",
          },
        }),
        path: "prod-1/cover.webp",
        supabaseUrl: "https://example.supabase.co",
      }),
    ).toThrow(/Host de imagen distinto/);
  });
});
