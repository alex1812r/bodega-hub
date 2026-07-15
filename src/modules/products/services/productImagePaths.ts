export const PRODUCT_IMAGES_BUCKET = "product-images";

export type ProductImageFormat = "png" | "webp";

export function getProductImageStoragePath(
  productId: string,
  format: ProductImageFormat = "webp",
) {
  return `${productId}/cover.${format}`;
}

export function getProductImageFormatFromMime(mimeType: string): ProductImageFormat {
  return mimeType === "image/png" ? "png" : "webp";
}

export function getProductImageStoragePaths(productId: string) {
  return [
    getProductImageStoragePath(productId, "webp"),
    getProductImageStoragePath(productId, "png"),
  ] as const;
}

export function buildProductImagePublicUrl(supabaseUrl: string, storagePath: string) {
  const base = supabaseUrl.replace(/\/$/, "");
  return `${base}/storage/v1/object/public/${PRODUCT_IMAGES_BUCKET}/${storagePath}`;
}

export function extractProductImageStoragePath(imageUrl: string | null | undefined) {
  if (!imageUrl) {
    return null;
  }

  const marker = `/storage/v1/object/public/${PRODUCT_IMAGES_BUCKET}/`;
  const index = imageUrl.indexOf(marker);

  if (index === -1) {
    return null;
  }

  return imageUrl.slice(index + marker.length);
}
