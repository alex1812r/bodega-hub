import { z } from "zod";

import { normalizeBarcode } from "@/modules/products/services/productSearch";
import { normalizeOptionalSku } from "@/shared/utils/skuGeneration";

import { packConversionInputSchema } from "./packConversionSchemas";
import { cleanText } from "./productText";

export const PRODUCT_CATEGORY_REQUIRED_MESSAGE = "El producto necesita una categoría.";
export const PRODUCT_CATEGORY_NOT_IN_STORE_MESSAGE =
  "La categoría no existe o no pertenece a esta tienda.";
export const PRODUCT_CATEGORY_INACTIVE_MESSAGE = "La categoría está inactiva: elige otra.";

export const optionalNullableBarcodeSchema = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value) =>
    value === undefined ? undefined : normalizeBarcode(value === null ? null : cleanText(value)),
  );

/**
 * SKU opcional: sin valor o en blanco queda `undefined`. En el alta de producto
 * el servidor lo genera desde el nombre; en la edición se conserva el actual.
 */
export const optionalSkuSchema = z
  .string()
  .optional()
  .transform(
    (value) => normalizeOptionalSku(value === undefined ? undefined : cleanText(value)) ?? undefined,
  );

/** Nombre del producto: sin caracteres de control ni espacios sobrantes, y no vacío. */
const productNameSchema = z.string().transform(cleanText).pipe(z.string().min(1));

/**
 * Categoría del producto. Que exista, sea de la tienda y esté activa lo valida
 * el servicio; vacía la rechaza con "El producto necesita una categoría.".
 */
const productCategoryIdSchema = z.string().transform(cleanText).optional();

/** Largo máximo de la descripción de un producto (ya sin espacios sobrantes). */
export const PRODUCT_DESCRIPTION_MAX_LENGTH = 500;

/**
 * Descripción del producto, opcional. En blanco o `null` queda `null` (en la
 * edición, la borra); ausente no viaja y la edición conserva la guardada.
 */
const productDescriptionSchema = z
  .string()
  .transform(cleanText)
  .pipe(
    z
      .string()
      .max(
        PRODUCT_DESCRIPTION_MAX_LENGTH,
        `La descripción admite hasta ${PRODUCT_DESCRIPTION_MAX_LENGTH} caracteres.`,
      ),
  )
  .nullish()
  .transform((value) => (value === undefined ? undefined : value || null));

export const optionalImageUrlSchema = z
  .union([z.string().url(), z.null()])
  .optional();

export const createProductSchema = z.object({
  barcode: optionalNullableBarcodeSchema,
  categoryId: productCategoryIdSchema,
  /**
   * Clave de idempotencia del alta (C6, como compras y ajustes): el reintento de
   * un envío cuya respuesta se perdió devuelve el producto ya creado.
   */
  clientRequestId: z.string().uuid().optional(),
  currentCostRef: z.number().min(0).optional(),
  currentStock: z.number().int().min(0).optional(),
  description: productDescriptionSchema,
  imageUrl: optionalImageUrlSchema,
  minStock: z.number().int().min(0).optional(),
  name: productNameSchema,
  packConversion: packConversionInputSchema.optional(),
  salePriceRef: z.number().min(0),
  sku: optionalSkuSchema,
});

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, sortKeysDeep(entry)]),
    );
  }

  return value;
}

/**
 * Huella del contenido de un alta (sin su `clientRequestId`): mismas claves y
 * valores dan el mismo texto, sea cual sea el orden. La misma clave de
 * idempotencia con otra huella no es un reintento: se rechaza con 409.
 */
export function buildProductCreateFingerprint(input: Record<string, unknown>) {
  return JSON.stringify(sortKeysDeep(input));
}

export const PRODUCT_CREATE_REQUEST_REUSED_MESSAGE =
  "La clave de idempotencia ya se usó en otro producto. Revisa el producto creado antes de reintentar.";

export const updateProductSchema = z.object({
  barcode: optionalNullableBarcodeSchema,
  categoryId: productCategoryIdSchema,
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
  description: productDescriptionSchema,
  imageUrl: optionalImageUrlSchema,
  isActive: z.boolean().optional(),
  minStock: z.number().int().min(0).optional(),
  name: productNameSchema.optional(),
  packConversion: packConversionInputSchema.optional(),
  salePriceRef: z.number().min(0).optional(),
  sku: optionalSkuSchema,
});

/** Solo asignar barcode cuando el producto aun no tiene uno. */
export const addProductBarcodeSchema = z.object({
  barcode: z
    .string()
    .transform(cleanText)
    .pipe(z.string().min(1, "El codigo de barras es obligatorio"))
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
  .transform(cleanText)
  .pipe(z.string().max(PRICE_CHANGE_REASON_MAX_LENGTH))
  .nullish()
  .transform((value) => value || null);

/** Tope de `products.current_cost_ref` (`numeric(12,2)`): ningún costo real lo supera. */
const EXPECTED_COST_REF_MAX = 9_999_999_999.99;

/**
 * Costo (REF) que el usuario tenía delante al decidir. Si viene y el costo del
 * producto ya es otro (a dos decimales), la base rechaza la operación con 409.
 */
const expectedCostRefSchema = z.number().min(0).max(EXPECTED_COST_REF_MAX).optional();

/** Cambio de precio (`POST /api/products/[id]/price`). */
export const productPriceSchema = z.object({
  expectedCostRef: expectedCostRefSchema,
  reason: priceReasonSchema,
  salePriceRef: z.number().min(0),
});

/**
 * "Mantener precio" (`POST /api/products/[id]/keep-price`). Sin motivo la RPC
 * `keep_product_price` guarda "Precio mantenido".
 */
export const keepProductPriceSchema = z.object({
  expectedCostRef: expectedCostRefSchema,
  reason: priceReasonSchema,
});

/** Productos por lote de reprecio. */
export const REPRICE_MAX_PRODUCTS = 100;

/** % mínimo de un reprecio: el % se guarda a dos decimales y menos que esto es 0. */
export const REPRICE_MIN_MARKUP_PCT = 0.01;

/** Tope del % de ganancia de un reprecio (el mismo de los chips de % de la tienda). */
export const REPRICE_MAX_MARKUP_PCT = 1000;

const repriceProductIdSchema = z.string().trim().min(1);

/**
 * Reprecio masivo (`POST /api/products/price-review/reprice`): precio = costo ×
 * (1 + % / 100) para cada producto, calculado en la base con el costo vigente.
 * Sin motivo se guarda "Reprecio al X %".
 *
 * Los productos llegan en `items` (con el costo que el usuario vio: si cambió,
 * esa fila responde `COST_CHANGED`), en `productIds` (sin esa comprobación) o en
 * ambos; entre los dos, de 1 a 100 productos distintos.
 */
export const repriceProductsSchema = z
  .object({
    items: z
      .array(
        z.object({
          expectedCostRef: z.number().min(0).max(EXPECTED_COST_REF_MAX),
          productId: repriceProductIdSchema,
        }),
      )
      .max(REPRICE_MAX_PRODUCTS)
      .optional(),
    markupPct: z.number().min(REPRICE_MIN_MARKUP_PCT).max(REPRICE_MAX_MARKUP_PCT),
    productIds: z.array(repriceProductIdSchema).max(REPRICE_MAX_PRODUCTS).optional(),
    reason: priceReasonSchema,
  })
  .superRefine((value, context) => {
    const count = new Set([
      ...(value.items ?? []).map((item) => item.productId),
      ...(value.productIds ?? []),
    ]).size;

    if (count < 1 || count > REPRICE_MAX_PRODUCTS) {
      context.addIssue({
        code: "custom",
        message: `Indica de 1 a ${REPRICE_MAX_PRODUCTS} productos.`,
        path: [value.items ? "items" : "productIds"],
      });
    }
  });

export type KeepProductPriceInput = z.infer<typeof keepProductPriceSchema>;
export type RepriceProductsInput = z.infer<typeof repriceProductsSchema>;
