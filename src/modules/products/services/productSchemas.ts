import { z } from "zod";

import { normalizeBarcode } from "@/modules/products/services/productSearch";
import { normalizeOptionalSku, normalizeSku } from "@/shared/utils/skuGeneration";

export const optionalNullableBarcodeSchema = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value) => (value === undefined ? undefined : normalizeBarcode(value)));

export const skuSchema = z.string().trim().min(1).transform(normalizeSku);

export const optionalSkuSchema = z
  .string()
  .optional()
  .transform((value) => normalizeOptionalSku(value) ?? undefined);

export const optionalImageUrlSchema = z
  .union([z.string().url(), z.null()])
  .optional();

export const createProductSchema = z.object({
  barcode: optionalNullableBarcodeSchema,
  categoryId: z.string().optional(),
  currentCostRef: z.number().min(0).optional(),
  currentStock: z.number().int().min(0).optional(),
  imageUrl: optionalImageUrlSchema,
  minStock: z.number().int().min(0).optional(),
  name: z.string().min(1),
  salePriceRef: z.number().min(0),
  sku: skuSchema,
});

export const updateProductSchema = z.object({
  barcode: optionalNullableBarcodeSchema,
  categoryId: z.string().optional(),
  currentCostRef: z.number().min(0).optional(),
  currentStock: z.number().int().min(0).optional(),
  imageUrl: optionalImageUrlSchema,
  isActive: z.boolean().optional(),
  minStock: z.number().int().min(0).optional(),
  name: z.string().min(1).optional(),
  salePriceRef: z.number().min(0).optional(),
  sku: skuSchema.optional(),
});
