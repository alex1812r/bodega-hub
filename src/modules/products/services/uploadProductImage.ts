import { apiFetch } from "@/shared/api/apiFetch";

import type { ProductWithCategory } from "../hooks/useProducts";
import {
  getProductImageFormatFromMime,
  type ProductImageFormat,
} from "./productImagePaths";

export type ProductImageUploadUrlResult = {
  path: string;
  publicUrl: string;
  uploadUrl: string;
};

export async function requestProductImageUploadUrl(
  productId: string,
  format: ProductImageFormat = "webp",
) {
  return apiFetch<ProductImageUploadUrlResult>(`/api/products/${productId}/image-upload-url`, {
    body: { format },
    method: "POST",
  });
}

export async function uploadProductImageBlob(productId: string, blob: Blob) {
  const format = getProductImageFormatFromMime(blob.type || "image/webp");
  const { publicUrl, uploadUrl } = await requestProductImageUploadUrl(productId, format);

  if (!uploadUrl.includes("mock-upload.local")) {
    const uploadResponse = await fetch(uploadUrl, {
      body: blob,
      headers: {
        "Content-Type": blob.type || "image/webp",
      },
      method: "PUT",
    });

    if (!uploadResponse.ok) {
      throw new Error("No se pudo subir la imagen del producto.");
    }
  }

  return apiFetch<ProductWithCategory>(`/api/products/${productId}`, {
    body: { imageUrl: publicUrl },
    method: "PATCH",
  });
}

export async function removeProductImage(productId: string) {
  return apiFetch<ProductWithCategory>(`/api/products/${productId}/image`, {
    method: "DELETE",
  });
}
