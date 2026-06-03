import { isUserRole, type UserRole } from "@/shared/auth/permissions";

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
  id: number;
  invoice_prefix: string;
  low_stock_threshold: number;
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
  return {
    ...mapBaseEntity(row),
    rateVes: Number(row.rate_ves),
    source: row.source ?? "Manual",
  };
}

export function mapAppSettings(row: AppSettingsRow) {
  return {
    businessName: row.business_name,
    defaultTaxRate: Number(row.default_tax_rate),
    invoicePrefix: row.invoice_prefix,
    lowStockThreshold: row.low_stock_threshold,
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
