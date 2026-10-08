import { z } from "zod";

import { normalizeBarcode } from "@/modules/products/services/productSearch";
import { normalizeOptionalSku } from "@/shared/utils/skuGeneration";

import { packConversionInputSchema } from "./packConversionSchemas";

export const optionalNullableBarcodeSchema = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value) => (value === undefined ? undefined : normalizeBarcode(value)));

/**
 * SKU opcional: sin valor o en blanco queda `undefined`. En el alta de producto
 * el servidor lo genera desde el nombre; en la edición se conserva el actual.
 */
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
  packConversion: packConversionInputSchema.optional(),
  salePriceRef: z.number().min(0),
  sku: optionalSkuSchema,
});

export const updateProductSchema = z.object({
  barcode: optionalNullableBarcodeSchema,
  categoryId: z.string().optional(),
  currentCostRef: z.number().min(0).optional(),
  // El stock no se edita por PATCH: escribirlo directo pisaba las ventas hechas
  // entre abrir y guardar el formulario y no dejaba fila en `stock_movements`.
  // Se rechaza en vez de ignorarse para que ningun cliente crea que lo guardo.
  currentStock: z
    .never({
      message:
        "El stock no se edita desde el producto. Usa un ajuste de inventario (POST /api/inventory/adjustments).",
    })
    .optional(),
  imageUrl: optionalImageUrlSchema,
  isActive: z.boolean().optional(),
  minStock: z.number().int().min(0).optional(),
  name: z.string().min(1).optional(),
  packConversion: packConversionInputSchema.optional(),
  salePriceRef: z.number().min(0).optional(),
  sku: optionalSkuSchema,
});

/** Solo asignar barcode cuando el producto aun no tiene uno. */
export const addProductBarcodeSchema = z.object({
  barcode: z
    .string()
    .trim()
    .min(1, "El codigo de barras es obligatorio")
    .transform((value) => normalizeBarcode(value))
    .refine((value): value is string => Boolean(value), {
      message: "El codigo de barras es obligatorio",
    }),
});

/** Largo máximo del motivo de un cambio de precio (ya sin espacios sobrantes). */
export const PRICE_CHANGE_REASON_MAX_LENGTH = 200;

/** Motivo que acompaña a un cambio de precio hecho desde la edición del producto. */
export const PRODUCT_EDIT_PRICE_REASON = "Edición del producto";

/** Motivo opcional: ausente, `null` o en blanco queda `null`, que es lo que recibe `p_reason`. */
const priceReasonSchema = z
  .string()
  .trim()
  .max(PRICE_CHANGE_REASON_MAX_LENGTH)
  .nullish()
  .transform((value) => value || null);

/** Cambio de precio (`POST /api/products/[id]/price`). */
export const productPriceSchema = z.object({
  reason: priceReasonSchema,
  salePriceRef: z.number().min(0),
});

/**
 * "Mantener precio" (`POST /api/products/[id]/keep-price`). Sin motivo la RPC
 * `keep_product_price` guarda "Precio mantenido".
 */
export const keepProductPriceSchema = z.object({
  reason: priceReasonSchema,
});

/** Productos por lote de reprecio. */
export const REPRICE_MAX_PRODUCTS = 100;

/** Tope del % de ganancia de un reprecio (el mismo de los chips de % de la tienda). */
export const REPRICE_MAX_MARKUP_PCT = 1000;

/**
 * Reprecio masivo (`POST /api/products/price-review/reprice`): precio = costo ×
 * (1 + % / 100) para cada producto. Sin motivo se guarda "Reprecio al X %".
 */
export const repriceProductsSchema = z.object({
  markupPct: z.number().gt(0).max(REPRICE_MAX_MARKUP_PCT),
  productIds: z.array(z.string().trim().min(1)).min(1).max(REPRICE_MAX_PRODUCTS),
  reason: priceReasonSchema,
});

export type KeepProductPriceInput = z.infer<typeof keepProductPriceSchema>;
export type RepriceProductsInput = z.infer<typeof repriceProductsSchema>;
