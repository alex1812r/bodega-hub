import { mapBaseEntity, mapBoolean, mapNullableString } from "@/lib/supabase/mappers/base";
import { mapContact, type DbContactRow } from "@/lib/supabase/mappers/contacts";
import { mapProductSummary, type DbProductSummaryRow } from "@/lib/supabase/mappers/products";
import { normalizeOptionalSku } from "@/shared/utils/skuGeneration";

import type { SupplierProductPriceOrigin } from "@/shared/mocks/erp-data";

import type { SupplierProductPackUnit } from "@/modules/contacts/services/supplierProducts.schemas";

export type DbSupplierProductPackUnitRow = {
  created_at?: string | null;
  id: string;
  is_active?: boolean | null;
  is_default?: boolean | null;
  label: string;
  supplier_product_id: string;
  units_per_pack: number;
  updated_at?: string | null;
};

export type DbSupplierProductRow = {
  created_at?: string | null;
  id: string;
  is_active?: boolean | null;
  last_cost_ref?: number | string | null;
  last_cost_ves?: number | string | null;
  last_pack_cost_ref?: number | string | null;
  last_purchased_at?: string | null;
  notes?: string | null;
  product?: DbProductSummaryRow | null;
  product_id: string;
  supplier?: DbContactRow | null;
  supplier_id: string;
  supplier_sku?: string | null;
  updated_at?: string | null;
};

export type DbSupplierProductPriceHistoryRow = {
  changed_by?: string | null;
  created_at?: string | null;
  id: string;
  new_cost_ref: number | string;
  new_cost_ves?: number | string | null;
  notes?: string | null;
  old_cost_ref?: number | string | null;
  old_cost_ves?: number | string | null;
  origin: string;
  supplier_product_id: string;
};

function toNumber(value: number | string | null | undefined, fallback = 0) {
  if (value === null || value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toOptionalNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function computeVariationPercent(
  oldCostRef: number | undefined,
  newCostRef: number,
): number | null {
  if (oldCostRef === undefined || oldCostRef <= 0) {
    return null;
  }

  return Number((((newCostRef - oldCostRef) / oldCostRef) * 100).toFixed(2));
}

export function mapSupplierProductPackUnit(row: DbSupplierProductPackUnitRow): SupplierProductPackUnit {
  return {
    id: row.id,
    isActive: mapBoolean(row.is_active, true),
    isDefault: mapBoolean(row.is_default, false),
    label: row.label,
    supplierProductId: row.supplier_product_id,
    unitsPerPack: row.units_per_pack,
  };
}

export function mapSupplierProduct(
  row: DbSupplierProductRow,
  extras?: {
    defaultPackUnit?: SupplierProductPackUnit;
    lastPriceOrigin?: SupplierProductPriceOrigin;
    packUnits?: SupplierProductPackUnit[];
    variationPercent?: number | null;
  },
) {
  const packUnits = extras?.packUnits;
  const defaultPackUnit =
    extras?.defaultPackUnit ??
    packUnits?.find((packUnit) => packUnit.isDefault && packUnit.isActive);

  return {
    ...mapBaseEntity(row),
    defaultPackUnit,
    isActive: mapBoolean(row.is_active, true),
    lastCostRef: toNumber(row.last_cost_ref),
    lastCostVes: toOptionalNumber(row.last_cost_ves),
    lastPackCostRef: toOptionalNumber(row.last_pack_cost_ref),
    lastPriceOrigin: extras?.lastPriceOrigin,
    lastPurchasedAt: mapNullableString(row.last_purchased_at),
    notes: mapNullableString(row.notes),
    packUnits,
    product: row.product ? mapProductSummary(row.product) : undefined,
    productId: row.product_id,
    supplier: row.supplier ? mapContact(row.supplier) : undefined,
    supplierId: row.supplier_id,
    supplierSku: normalizeOptionalSku(mapNullableString(row.supplier_sku)) ?? undefined,
    variationPercent: extras?.variationPercent ?? null,
  };
}

export function mapSupplierProductPriceHistory(row: DbSupplierProductPriceHistoryRow) {
  const oldCostRef = toOptionalNumber(row.old_cost_ref);
  const newCostRef = toNumber(row.new_cost_ref);

  return {
    changedBy: mapNullableString(row.changed_by),
    createdAt: row.created_at ?? new Date().toISOString(),
    id: row.id,
    newCostRef,
    newCostVes: toOptionalNumber(row.new_cost_ves),
    notes: mapNullableString(row.notes),
    oldCostRef,
    oldCostVes: toOptionalNumber(row.old_cost_ves),
    origin: row.origin as SupplierProductPriceOrigin,
    supplierProductId: row.supplier_product_id,
    variationPercent: computeVariationPercent(oldCostRef, newCostRef),
  };
}
