import { ApiError } from "@/lib/api/apiError";
import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { getSupabaseUrl } from "@/lib/supabase/env";

import {
  buildProductImagePublicUrl,
  getProductImageStoragePath,
  getProductImageStoragePaths,
  PRODUCT_IMAGES_BUCKET,
  type ProductImageFormat,
} from "./productImagePaths";
import { getProductById, updateProduct } from "./products.server";

export type ProductImageUploadUrlResult = {
  path: string;
  publicUrl: string;
  uploadUrl: string;
};

async function removeExistingProductImages(productId: string) {
  const supabase = createAdminSupabaseClient();
  await supabase.storage.from(PRODUCT_IMAGES_BUCKET).remove([...getProductImageStoragePaths(productId)]);
}

export async function createProductImageUploadUrl(
  productId: string,
  format: ProductImageFormat,
  storeId: string,
) {
  await getProductById(productId, storeId);

  const path = getProductImageStoragePath(productId, format);
  const supabase = createAdminSupabaseClient();

  await removeExistingProductImages(productId);

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

  return {
    path,
    publicUrl: buildProductImagePublicUrl(getSupabaseUrl(), path),
    uploadUrl: data.signedUrl,
  } satisfies ProductImageUploadUrlResult;
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
