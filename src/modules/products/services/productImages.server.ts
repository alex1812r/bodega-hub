import { ApiError } from "@/lib/api/apiError";
import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { getSupabaseUrl } from "@/lib/supabase/env";

import {
  getProductImageStoragePath,
  getProductImageStoragePaths,
  PRODUCT_IMAGES_BUCKET,
  resolveProductImagePublicUrlFromStorage,
  type ProductImageFormat,
} from "./productImagePaths";
import { getProductById, updateProduct } from "./products.server";

export type ProductImageUploadUrlResult = {
  path: string;
  publicUrl: string;
  uploadUrl: string;
};

function resolvePublicUrlForPath(path: string) {
  const supabase = createAdminSupabaseClient();
  return resolveProductImagePublicUrlFromStorage({
    getPublicUrl: (storagePath) =>
      supabase.storage.from(PRODUCT_IMAGES_BUCKET).getPublicUrl(storagePath),
    path,
    supabaseUrl: getSupabaseUrl(),
  });
}

async function assertProductImageObjectExists(path: string) {
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase.storage.from(PRODUCT_IMAGES_BUCKET).download(path);

  if (error || !data) {
    throw new ApiError(
      400,
      "BAD_REQUEST",
      error?.message ?? "La imagen aun no existe en Storage. Sube el archivo antes de confirmar.",
    );
  }
}

async function removeOtherProductImageFormats(productId: string, keepFormat: ProductImageFormat) {
  const supabase = createAdminSupabaseClient();
  const toRemove = getProductImageStoragePaths(productId).filter(
    (path) => path !== getProductImageStoragePath(productId, keepFormat),
  );

  if (toRemove.length === 0) {
    return;
  }

  await supabase.storage.from(PRODUCT_IMAGES_BUCKET).remove([...toRemove]);
}

export async function createProductImageUploadUrl(
  productId: string,
  format: ProductImageFormat,
  storeId: string,
) {
  await getProductById(productId, storeId);

  const path = getProductImageStoragePath(productId, format);
  const supabase = createAdminSupabaseClient();

  // Upsert only — do not delete existing covers first (avoids NoSuchKey if PUT fails).
  const { data, error } = await supabase.storage
    .from(PRODUCT_IMAGES_BUCKET)
    .createSignedUploadUrl(path, { upsert: true });

  if (error || !data?.signedUrl) {
    throw new ApiError(
      500,
      "INTERNAL_ERROR",
      error?.message ?? "No se pudo generar la URL de subida.",
    );
  }

  const publicUrl = resolvePublicUrlForPath(path);

  return {
    path,
    publicUrl,
    uploadUrl: data.signedUrl,
  } satisfies ProductImageUploadUrlResult;
}

/**
 * After the client PUT succeeds: verify the object, drop the other format, persist image_url.
 */
export async function confirmProductImageUpload(
  productId: string,
  format: ProductImageFormat,
  storeId: string,
) {
  await getProductById(productId, storeId);

  const path = getProductImageStoragePath(productId, format);
  await assertProductImageObjectExists(path);

  const publicUrl = resolvePublicUrlForPath(path);
  await removeOtherProductImageFormats(productId, format);

  return updateProduct(productId, { imageUrl: publicUrl }, storeId);
}

export async function deleteProductImage(productId: string, storeId: string) {
  await getProductById(productId, storeId);

  const supabase = createAdminSupabaseClient();
  const { error } = await supabase.storage
    .from(PRODUCT_IMAGES_BUCKET)
    .remove([...getProductImageStoragePaths(productId)]);

  if (error) {
    throw new ApiError(500, "INTERNAL_ERROR", error.message);
  }

  return updateProduct(productId, { imageUrl: null }, storeId);
}
