import { z } from "zod";

import { ApiError } from "@/lib/api/apiError";
import { normalizeBarcode } from "@/modules/products/services/productSearch";
import { normalizeOptionalSku } from "@/shared/utils/skuGeneration";

const optionalNullableBarcodeSchema = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value) => (value === undefined ? undefined : normalizeBarcode(value)));

const optionalSkuSchema = z
  .string()
  .optional()
  .transform((value) => normalizeOptionalSku(value) ?? undefined);

export const packConversionUnitProductSchema = z.object({
  barcode: optionalNullableBarcodeSchema,
  currentCostRef: z.number().min(0).optional(),
  name: z.string().min(1).optional(),
  salePriceRef: z.number().min(0),
  sku: optionalSkuSchema,
});

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

/** Un producto que sale del empaque surtido. Sin `costWeight`, el peso es 1. */
export const packConversionComponentSchema = z.object({
  costWeight: z
    .number({ message: COST_WEIGHT_MESSAGE })
    .positive(COST_WEIGHT_MESSAGE)
    .refine(Number.isFinite, COST_WEIGHT_MESSAGE)
    .default(1),
  unitProductId: z.string().min(1, "Selecciona el producto de cada componente."),
  unitsPerPack: z
    .number({ message: COMPONENT_UNITS_MESSAGE })
    .int(COMPONENT_UNITS_MESSAGE)
    .positive(COMPONENT_UNITS_MESSAGE),
});

/**
 * Vínculo de empaque que viaja en el alta / edición de un producto.
 * - `link_existing` / `create_unit`: el par de siempre (un producto unidad).
 * - `assorted`: receta surtida (`totalUnits`, `components`, `label` opcional).
 * - `enabled: false`: desactiva la receta del producto.
 */
export const packConversionInputSchema = z
  .object({
    components: z.array(packConversionComponentSchema).optional(),
    enabled: z.boolean(),
    label: z
      .string()
      .trim()
      .max(
        PACK_RECIPE_LABEL_MAX_LENGTH,
        `El nombre de la receta admite hasta ${PACK_RECIPE_LABEL_MAX_LENGTH} caracteres.`,
      )
      .nullish(),
    mode: z.enum(["assorted", "create_unit", "link_existing"]).optional(),
    totalUnits: z
      .number({ message: TOTAL_UNITS_MESSAGE })
      .int(TOTAL_UNITS_MESSAGE)
      .min(2, TOTAL_UNITS_MESSAGE)
      .optional(),
    unitProduct: packConversionUnitProductSchema.optional(),
    unitProductId: z.string().min(1).optional(),
    unitsPerPack: z.number().int().min(2).optional(),
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
        message: "Indica unidades por empaque (mínimo 2).",
        path: ["unitsPerPack"],
      });
    }

    if (value.mode === "link_existing") {
      if (!value.unitProductId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Selecciona el producto unidad.",
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
export const packDistributionItemSchema = z.object({
  unitProductId: z.string().min(1, "Cada componente del reparto requiere su producto."),
  units: z
    .number({ message: DISTRIBUTION_UNITS_MESSAGE })
    .int(DISTRIBUTION_UNITS_MESSAGE)
    .min(0, DISTRIBUTION_UNITS_MESSAGE),
});

export const convertPackToUnitsSchema = z.object({
  /**
   * Opcional. Sin él cada componente recibe lo que dice la receta; con él debe
   * sumar `totalUnits × packQuantity` y nombrar solo componentes de la receta.
   */
  components: z
    .array(packDistributionItemSchema)
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
  packProductId: z.string().min(1),
  packQuantity: z.number().int().positive(),
  reason: z.string().optional(),
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
