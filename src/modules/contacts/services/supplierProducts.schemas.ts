import { z } from "zod";

import { optionalSkuSchema } from "@/modules/products/services/productSchemas";

export const supplierProductPriceOriginSchema = z.enum([
  "cotizacion",
  "compra",
  "ajuste",
  "vinculacion",
]);

export const supplierProductInputSchema = z.object({
  lastCostRef: z.number().min(0).optional(),
  lastCostVes: z.number().min(0).optional(),
  notes: z.string().optional(),
  productId: z.string().min(1),
  supplierId: z.string().min(1),
  supplierSku: optionalSkuSchema,
});

export const supplierProductUpdateSchema = z.object({
  isActive: z.boolean().optional(),
  notes: z.string().optional(),
  supplierSku: optionalSkuSchema,
});

export const supplierProductPriceInputSchema = z.object({
  newCostRef: z.number().min(0),
  newCostVes: z.number().min(0).optional(),
  newPackCostRef: z.number().min(0).optional(),
  notes: z.string().optional(),
  origin: supplierProductPriceOriginSchema,
  priceInputMode: z.enum(["pack", "unit"]).optional(),
});

export type SupplierProductPriceOrigin = z.infer<typeof supplierProductPriceOriginSchema>;
export type SupplierProductInput = z.infer<typeof supplierProductInputSchema>;
export type SupplierProductUpdateInput = z.infer<typeof supplierProductUpdateSchema>;
export type SupplierProductPriceInput = z.infer<typeof supplierProductPriceInputSchema>;

export type SupplierProduct = {
  id: string;
  isActive: boolean;
  lastCostRef?: number;
  lastCostVes?: number;
  lastPackCostRef?: number;
  lastPriceOrigin?: SupplierProductPriceOrigin;
  lastPurchasedAt?: string;
  notes?: string;
  product?: {
    id: string;
    name: string;
    sku: string;
  };
  productId: string;
  supplier?: {
    id: string;
    name: string;
    type: string;
  };
  supplierId: string;
  supplierSku?: string;
  variationPercent?: number | null;
  packUnits?: SupplierProductPackUnit[];
  defaultPackUnit?: SupplierProductPackUnit;
};

export type SupplierProductPriceHistory = {
  changedBy?: string;
  createdAt: string;
  id: string;
  newCostRef: number;
  newCostVes?: number;
  notes?: string;
  oldCostRef?: number;
  oldCostVes?: number;
  origin: SupplierProductPriceOrigin;
  supplierProductId: string;
  variationPercent?: number | null;
};

export type RegisterSupplierPriceResult = {
  historyId: string;
  supplierProduct: SupplierProduct;
  variationPercent?: number | null;
};

export const supplierProductPackUnitInputSchema = z.object({
  isDefault: z.boolean().optional(),
  label: z.string().min(1),
  unitsPerPack: z.number().int().positive(),
});

export const supplierProductPackUnitUpdateSchema = z.object({
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  label: z.string().min(1).optional(),
  unitsPerPack: z.number().int().positive().optional(),
});

export type SupplierProductPackUnitInput = z.infer<typeof supplierProductPackUnitInputSchema>;
export type SupplierProductPackUnitUpdateInput = z.infer<typeof supplierProductPackUnitUpdateSchema>;

export type SupplierProductPackUnit = {
  id: string;
  isActive: boolean;
  isDefault: boolean;
  label: string;
  supplierProductId: string;
  unitsPerPack: number;
};
