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

export function normalizeSupabaseBaseUrl(supabaseUrl: string) {
  return supabaseUrl.replace(/\/$/, "");
}

export function buildProductImagePublicUrl(supabaseUrl: string, storagePath: string) {
  const base = normalizeSupabaseBaseUrl(supabaseUrl);
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

export function getAllowedProductImagePublicUrls(supabaseUrl: string, productId: string) {
  return getProductImageStoragePaths(productId).map((path) =>
    buildProductImagePublicUrl(supabaseUrl, path),
  );
}

/** Same origin as NEXT_PUBLIC_SUPABASE_URL (ignores trailing slash). */
export function assertProductImagePublicUrlHost(supabaseUrl: string, publicUrl: string) {
  let expected: URL;
  let actual: URL;

  try {
    expected = new URL(normalizeSupabaseBaseUrl(supabaseUrl));
    actual = new URL(publicUrl);
  } catch {
    throw new Error("La URL publica de la imagen no es valida.");
  }

  if (actual.protocol !== "https:" || actual.host !== expected.host) {
    throw new Error(
      `Host de imagen distinto al de Supabase (esperado ${expected.host}, recibido ${actual.host}).`,
    );
  }
}

/**
 * Accept only public cover URLs for this product under product-images on our Supabase host.
 */
export function assertAllowedProductImageUrl(
  supabaseUrl: string,
  productId: string,
  imageUrl: string,
) {
  assertProductImagePublicUrlHost(supabaseUrl, imageUrl);

  const allowed = getAllowedProductImagePublicUrls(supabaseUrl, productId);
  if (!allowed.includes(imageUrl)) {
    throw new Error(
      "imageUrl debe ser la URL publica cover.webp o cover.png del producto en product-images.",
    );
  }
}

export function resolveProductImagePublicUrlFromStorage(params: {
  getPublicUrl: (path: string) => { data: { publicUrl: string } };
  path: string;
  supabaseUrl: string;
}) {
  const { data } = params.getPublicUrl(params.path);
  const publicUrl = data.publicUrl;

  assertProductImagePublicUrlHost(params.supabaseUrl, publicUrl);

  const expected = buildProductImagePublicUrl(params.supabaseUrl, params.path);
  if (publicUrl !== expected) {
    throw new Error(
      `getPublicUrl no coincide con la URL esperada (getPublicUrl=${publicUrl}, esperado=${expected}).`,
    );
  }

  return publicUrl;
}
