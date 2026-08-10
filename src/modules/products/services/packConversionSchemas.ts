import { z } from "zod";

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

export const packConversionInputSchema = z
  .object({
    enabled: z.boolean(),
    mode: z.enum(["create_unit", "link_existing"]).optional(),
    unitProduct: packConversionUnitProductSchema.optional(),
    unitProductId: z.string().min(1).optional(),
    unitsPerPack: z.number().int().min(2).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.enabled) {
      return;
    }

    if (value.unitsPerPack == null || value.unitsPerPack < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Indica unidades por empaque (minimo 2).",
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

export const convertPackToUnitsSchema = z.object({
  packProductId: z.string().min(1),
  packQuantity: z.number().int().positive(),
  reason: z.string().optional(),
});

export type PackConversionInput = z.infer<typeof packConversionInputSchema>;
export type ConvertPackToUnitsInput = z.infer<typeof convertPackToUnitsSchema>;
