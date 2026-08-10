import { mapBaseEntity, mapBoolean, mapNullableString } from "./base";

export type CategoryRow = {
  description?: string | null;
  id: string;
  is_active?: boolean | null;
  name: string;
  tax_rate?: number | string | null;
};

function toTaxRate(value: number | string | null | undefined) {
  if (value === null || value === undefined) {
    return 16;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 16;
}

export function mapCategory(row: CategoryRow) {
  return {
    ...mapBaseEntity(row),
    description: mapNullableString(row.description),
    isActive: mapBoolean(row.is_active, true),
    name: row.name,
    taxRate: toTaxRate(row.tax_rate),
  };
}
