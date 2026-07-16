import { mockProducts } from "@/shared/mocks/erp-data";

import {
  buildProductImagePublicUrl,
  getProductImageStoragePath,
  type ProductImageFormat,
} from "./productImagePaths";
import { getProductById, updateProduct } from "./products.mock-server";

const MOCK_SUPABASE_URL = "https://mock-project.supabase.co";

export async function createProductImageUploadUrl(
  productId: string,
  format: ProductImageFormat,
  storeId: string,
) {
  getProductById(productId, storeId);

  const path = getProductImageStoragePath(productId, format);

  return {
    path,
    publicUrl: buildProductImagePublicUrl(MOCK_SUPABASE_URL, path),
    uploadUrl: `https://mock-upload.local/${path}?token=mock`,
  };
}

export async function deleteProductImage(productId: string, storeId: string) {
  getProductById(productId, storeId);
  return updateProduct(productId, { imageUrl: null }, storeId);
}

export function applyMockProductImageUpload(productId: string) {
  const product = mockProducts.find((item) => item.id === productId);

  if (product) {
    product.imageUrl = buildProductImagePublicUrl(
      MOCK_SUPABASE_URL,
      getProductImageStoragePath(productId),
    );
  }
}
