import { z } from "zod";

import type { ProductImageFormat } from "./productImagePaths";

export const productImageFormatSchema = z.enum(["webp", "png"]);

export type ProductImageUploadOptions = {
  format?: ProductImageFormat;
};

export function parseProductImageUploadOptions(body: unknown): ProductImageUploadOptions {
  if (!body || typeof body !== "object") {
    return { format: "webp" };
  }

  const parsed = productImageFormatSchema.safeParse(
    (body as { format?: unknown }).format ?? "webp",
  );

  return { format: parsed.success ? parsed.data : "webp" };
}
