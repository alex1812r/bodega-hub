import { mapBaseEntity, mapBoolean, mapNullableString } from "./base";

export type CategoryRow = {
  default_markup_pct?: number | string | null;
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

/** % de ganancia sugerido de la categoria; `undefined` si no tiene. */
function toDefaultMarkupPct(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function mapCategory(row: CategoryRow) {
  return {
    ...mapBaseEntity(row),
    defaultMarkupPct: toDefaultMarkupPct(row.default_markup_pct),
    description: mapNullableString(row.description),
    isActive: mapBoolean(row.is_active, true),
    name: row.name,
    taxRate: toTaxRate(row.tax_rate),
  };
}
