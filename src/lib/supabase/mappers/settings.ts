import { isUserRole, type UserRole } from "@/shared/auth/permissions";
import { normalizeEnabledPaymentMethods } from "@/shared/payments/paymentMethods";
import { DEFAULT_MARGIN_THRESHOLDS, DEFAULT_MARKUP_CHIPS } from "@/shared/utils/pricing";

import { mapBaseEntity, mapBoolean } from "./base";
import { mapPermissionList } from "./permissions";

export type ExchangeRateRow = {
  created_at: string;
  id: string;
  rate_ves: number | string;
  source?: string | null;
};

export type AppSettingsRow = {
  business_name: string;
  default_tax_rate: number | string;
  enabled_payment_methods?: unknown;
  id: number;
  invoice_prefix: string;
  low_stock_threshold: number;
};

/** Columnas de precios de `app_settings` (parche 20261009b). */
export type PricingSettingsRow = {
  margin_green_from_pct?: number | string | null;
  margin_yellow_from_pct?: number | string | null;
  markup_chips_pct?: ReadonlyArray<number | string> | null;
};

export type ProfileListRow = {
  denied_permissions: unknown;
  full_name: string | null;
  granted_permissions: unknown;
  id: string;
  is_active: boolean;
  role: string;
};

export function mapExchangeRate(row: ExchangeRateRow) {
  const { id } = mapBaseEntity(row);

  return {
    id,
    createdAt: row.created_at ?? new Date().toISOString(),
    rateVes: Number(row.rate_ves),
    source: row.source ?? "Manual",
  };
}

export function mapAppSettings(row: AppSettingsRow) {
  return {
    businessName: row.business_name,
    defaultTaxRate: Number(row.default_tax_rate),
    enabledPaymentMethods: normalizeEnabledPaymentMethods(row.enabled_payment_methods),
    invoicePrefix: row.invoice_prefix,
    lowStockThreshold: row.low_stock_threshold,
  };
}

function toFiniteNumber(value: number | string | null | undefined, fallback: number) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Semaforo de ganancia y chips de % de la tienda. Sin fila (o sin la columna)
 * valen los por defecto de `@bodega/core`. Los chips salen en orden ascendente.
 */
export function mapPricingSettings(row: PricingSettingsRow | null | undefined) {
  const chips = (row?.markup_chips_pct ?? [])
    .map((chip) => Number(chip))
    .filter((chip) => Number.isFinite(chip));

  return {
    chipsPct: (chips.length > 0 ? chips : [...DEFAULT_MARKUP_CHIPS]).sort(
      (first, second) => first - second,
    ),
    greenFromPct: toFiniteNumber(row?.margin_green_from_pct, DEFAULT_MARGIN_THRESHOLDS.high),
    yellowFromPct: toFiniteNumber(row?.margin_yellow_from_pct, DEFAULT_MARGIN_THRESHOLDS.low),
  };
}

export function mapUserProfile(row: ProfileListRow, email = "") {
  const role = isUserRole(row.role) ? row.role : ("vendedor" as UserRole);

  return {
    deniedPermissions: mapPermissionList(row.denied_permissions),
    email,
    grantedPermissions: mapPermissionList(row.granted_permissions),
    id: row.id,
    isActive: mapBoolean(row.is_active, true),
    name: row.full_name?.trim() || email || "Usuario",
    role,
  };
}
