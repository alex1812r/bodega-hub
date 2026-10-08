import { z } from "zod";

import { ApiError } from "@/lib/api/apiError";
import { normalizeBarcode } from "@/modules/products/services/productSearch";
import { normalizeOptionalSku } from "@/shared/utils/skuGeneration";

import { cleanText } from "./productText";

// Los mensajes de forma llegan a la pantalla en `error.issues`: todos en español.
const UNIT_BARCODE_MESSAGE = "El código de barras de la unidad debe ser un texto.";
const UNIT_SKU_MESSAGE = "El SKU de la unidad debe ser un texto.";
const UNIT_COST_MESSAGE = "El costo de la unidad debe ser un número mayor o igual a cero.";
const UNIT_NAME_MESSAGE = "Escribe el nombre de la unidad.";
const UNIT_SALE_PRICE_MESSAGE = "Indica el precio de venta de la unidad (cero o más).";
const UNIT_PRODUCT_MESSAGE = "Completa los datos de la unidad.";

const optionalNullableBarcodeSchema = z
  .union([z.string(), z.null()], { message: UNIT_BARCODE_MESSAGE })
  .optional()
  .transform((value) =>
    value === undefined ? undefined : normalizeBarcode(value === null ? null : cleanText(value)),
  );

const optionalSkuSchema = z
  .string({ message: UNIT_SKU_MESSAGE })
  .optional()
  .transform(
    (value) => normalizeOptionalSku(value === undefined ? undefined : cleanText(value)) ?? undefined,
  );

export const packConversionUnitProductSchema = z.object(
  {
    barcode: optionalNullableBarcodeSchema,
    currentCostRef: z.number({ message: UNIT_COST_MESSAGE }).min(0, UNIT_COST_MESSAGE).optional(),
    name: z
      .string({ message: UNIT_NAME_MESSAGE })
      .transform(cleanText)
      .pipe(z.string().min(1, UNIT_NAME_MESSAGE))
      .optional(),
    salePriceRef: z.number({ message: UNIT_SALE_PRICE_MESSAGE }).min(0, UNIT_SALE_PRICE_MESSAGE),
    sku: optionalSkuSchema,
  },
  { message: UNIT_PRODUCT_MESSAGE },
);

/** Componentes de una receta surtida: de 2 (con 1 es un vínculo de siempre) a 20. */
export const ASSORTED_PACK_MIN_COMPONENTS = 2;
export const ASSORTED_PACK_MAX_COMPONENTS = 20;

/** Largo máximo del nombre opcional de la receta. */
export const PACK_RECIPE_LABEL_MAX_LENGTH = 80;

const COMPONENT_UNITS_MESSAGE = "Las unidades de cada componente deben ser un entero mayor a cero.";
const COST_WEIGHT_MESSAGE = "El peso de costo de cada componente debe ser un número mayor a cero.";
const TOTAL_UNITS_MESSAGE = "Indica el total de unidades del empaque (mínimo 2).";
const DISTRIBUTION_UNITS_MESSAGE =
  "Las unidades del reparto deben ser enteros mayores o iguales a cero.";
const COMPONENT_PRODUCT_MESSAGE = "Selecciona el producto de cada componente.";
const COMPONENT_MESSAGE = "Cada componente del empaque requiere su producto y sus unidades.";
const COMPONENTS_LIST_MESSAGE = "Los componentes del empaque deben ser una lista.";
const ENABLED_MESSAGE = "Indica si el empaque está activo.";
const LABEL_MESSAGE = "El nombre de la receta debe ser un texto.";
const MODE_MESSAGE = "El tipo de empaque no es válido.";
const UNIT_PRODUCT_ID_MESSAGE = "Selecciona el producto unidad.";
const UNITS_PER_PACK_MESSAGE = "Indica unidades por empaque (mínimo 2).";
const DISTRIBUTION_PRODUCT_MESSAGE = "Cada componente del reparto requiere su producto.";
const DISTRIBUTION_ITEM_MESSAGE = "Cada componente del reparto requiere su producto y sus unidades.";
const DISTRIBUTION_LIST_MESSAGE = "El reparto debe ser una lista de componentes.";
const PACK_PRODUCT_MESSAGE = "Selecciona el empaque que vas a abrir.";
const PACK_QUANTITY_MESSAGE = "La cantidad de empaques debe ser un entero mayor que 0.";
const REASON_MESSAGE = "El motivo debe ser un texto.";

/** Un producto que sale del empaque surtido. Sin `costWeight`, el peso es 1. */
export const packConversionComponentSchema = z.object(
  {
    costWeight: z
      .number({ message: COST_WEIGHT_MESSAGE })
      .positive(COST_WEIGHT_MESSAGE)
      .refine(Number.isFinite, COST_WEIGHT_MESSAGE)
      .default(1),
    unitProductId: z
      .string({ message: COMPONENT_PRODUCT_MESSAGE })
      .min(1, COMPONENT_PRODUCT_MESSAGE),
    unitsPerPack: z
      .number({ message: COMPONENT_UNITS_MESSAGE })
      .int(COMPONENT_UNITS_MESSAGE)
      .positive(COMPONENT_UNITS_MESSAGE),
  },
  { message: COMPONENT_MESSAGE },
);

/**
 * Vínculo de empaque que viaja en el alta / edición de un producto.
 * - `link_existing` / `create_unit`: el par de siempre (un producto unidad).
 * - `assorted`: receta surtida (`totalUnits`, `components`, `label` opcional).
 * - `enabled: false`: desactiva la receta del producto.
 */
export const packConversionInputSchema = z
  .object({
    components: z
      .array(packConversionComponentSchema, { message: COMPONENTS_LIST_MESSAGE })
      .optional(),
    enabled: z.boolean({ message: ENABLED_MESSAGE }),
    label: z
      .string({ message: LABEL_MESSAGE })
      .transform(cleanText)
      .pipe(
        z
          .string()
          .max(
            PACK_RECIPE_LABEL_MAX_LENGTH,
            `El nombre de la receta admite hasta ${PACK_RECIPE_LABEL_MAX_LENGTH} caracteres.`,
          ),
      )
      .nullish(),
    mode: z
      .enum(["assorted", "create_unit", "link_existing"], { message: MODE_MESSAGE })
      .optional(),
    totalUnits: z
      .number({ message: TOTAL_UNITS_MESSAGE })
      .int(TOTAL_UNITS_MESSAGE)
      .min(2, TOTAL_UNITS_MESSAGE)
      .optional(),
    unitProduct: packConversionUnitProductSchema.optional(),
    unitProductId: z
      .string({ message: UNIT_PRODUCT_ID_MESSAGE })
      .min(1, UNIT_PRODUCT_ID_MESSAGE)
      .optional(),
    unitsPerPack: z
      .number({ message: UNITS_PER_PACK_MESSAGE })
      .int(UNITS_PER_PACK_MESSAGE)
      .min(2, UNITS_PER_PACK_MESSAGE)
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.enabled) {
      return;
    }

    if (value.mode === "assorted") {
      const components = value.components ?? [];

      if (value.totalUnits == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: TOTAL_UNITS_MESSAGE,
          path: ["totalUnits"],
        });
      }

      if (
        components.length < ASSORTED_PACK_MIN_COMPONENTS ||
        components.length > ASSORTED_PACK_MAX_COMPONENTS
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Un empaque surtido lleva entre ${ASSORTED_PACK_MIN_COMPONENTS} y ${ASSORTED_PACK_MAX_COMPONENTS} componentes.`,
          path: ["components"],
        });
        return;
      }

      if (new Set(components.map((component) => component.unitProductId)).size !== components.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Un producto no puede repetirse entre los componentes del empaque.",
          path: ["components"],
        });
        return;
      }

      const componentUnits = components.reduce(
        (total, component) => total + component.unitsPerPack,
        0,
      );

      if (value.totalUnits != null && componentUnits !== value.totalUnits) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Los componentes suman ${componentUnits} unidades y el empaque declara ${value.totalUnits}.`,
          path: ["components"],
        });
      }

      return;
    }

    if (value.unitsPerPack == null || value.unitsPerPack < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: UNITS_PER_PACK_MESSAGE,
        path: ["unitsPerPack"],
      });
    }

    if (value.mode === "link_existing") {
      if (!value.unitProductId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: UNIT_PRODUCT_ID_MESSAGE,
          path: ["unitProductId"],
        });
      }
      return;
    }

    if (value.unitProduct?.salePriceRef == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Indica el precio de venta de la unidad.",
        path: ["unitProduct", "salePriceRef"],
      });
    }
  });

/** Reparto real de una apertura: cuántas unidades de un componente salieron. */
export const packDistributionItemSchema = z.object(
  {
    unitProductId: z
      .string({ message: DISTRIBUTION_PRODUCT_MESSAGE })
      .min(1, DISTRIBUTION_PRODUCT_MESSAGE),
    units: z
      .number({ message: DISTRIBUTION_UNITS_MESSAGE })
      .int(DISTRIBUTION_UNITS_MESSAGE)
      .min(0, DISTRIBUTION_UNITS_MESSAGE),
  },
  { message: DISTRIBUTION_ITEM_MESSAGE },
);

export const convertPackToUnitsSchema = z.object({
  /**
   * Opcional. Sin él cada componente recibe lo que dice la receta; con él debe
   * sumar `totalUnits × packQuantity` y nombrar solo componentes de la receta.
   */
  components: z
    .array(packDistributionItemSchema, { message: DISTRIBUTION_LIST_MESSAGE })
    .min(1, "El reparto debe traer al menos un componente.")
    .max(
      ASSORTED_PACK_MAX_COMPONENTS,
      `El reparto admite hasta ${ASSORTED_PACK_MAX_COMPONENTS} componentes.`,
    )
    .refine(
      (items) => new Set(items.map((item) => item.unitProductId)).size === items.length,
      "El reparto repite un componente de la receta.",
    )
    .optional(),
  packProductId: z.string({ message: PACK_PRODUCT_MESSAGE }).min(1, PACK_PRODUCT_MESSAGE),
  packQuantity: z
    .number({ message: PACK_QUANTITY_MESSAGE })
    .int(PACK_QUANTITY_MESSAGE)
    .positive(PACK_QUANTITY_MESSAGE),
  // Solo recorta: los caracteres de control no se quitan en silencio, la ruta los
  // rechaza con 400 igual que en un ajuste (`assertStockReasonCharacters`).
  reason: z
    .string({ message: REASON_MESSAGE })
    .transform((value) => value.trim())
    .optional(),
});

/**
 * Filtro `packLink` de `GET /api/products`:
 * - `none`: productos sin ningún vínculo de empaque activo (ni empaque ni componente);
 * - `not-pack`: productos que no son el EMPAQUE de una receta activa. Son los que
 *   pueden ser unidad / componente: un producto puede salir de varios empaques.
 * Cualquier otro valor no filtra.
 */
export type PackLinkFilter = "none" | "not-pack";

export function parsePackLinkFilter(searchParams: URLSearchParams): PackLinkFilter | null {
  const value = searchParams.get("packLink");

  return value === "none" || value === "not-pack" ? value : null;
}

export type PackConversionInput = z.infer<typeof packConversionInputSchema>;
export type PackConversionComponentInput = z.infer<typeof packConversionComponentSchema>;
export type PackDistributionItem = z.infer<typeof packDistributionItemSchema>;
export type ConvertPackToUnitsInput = z.infer<typeof convertPackToUnitsSchema>;

/**
 * El reparto de una apertura contra la receta activa del empaque, con las reglas
 * de `convert_pack_to_units` (que las vuelve a comprobar): solo componentes de la
 * receta, sin repetidos y suma = unidades de la receta × empaques.
 */
export function assertPackDistribution(
  recipe: { componentIds: string[]; totalUnits: number },
  packQuantity: number,
  distribution: PackDistributionItem[],
) {
  const seen = new Set<string>();

  for (const item of distribution) {
    if (!recipe.componentIds.includes(item.unitProductId)) {
      throw new ApiError(
        400,
        "BAD_REQUEST",
        "Un producto del reparto no es componente de la receta del empaque.",
      );
    }

    if (seen.has(item.unitProductId)) {
      throw new ApiError(400, "BAD_REQUEST", "El reparto repite un componente de la receta.");
    }

    seen.add(item.unitProductId);
  }

  const expectedUnits = recipe.totalUnits * packQuantity;
  const sentUnits = distribution.reduce((total, item) => total + item.units, 0);

  if (sentUnits !== expectedUnits) {
    throw new ApiError(
      400,
      "BAD_REQUEST",
      `El reparto debe sumar ${expectedUnits} unidades (${packQuantity} empaques × ${recipe.totalUnits}) y suma ${sentUnits}.`,
    );
  }
}
