import { mapBaseEntity, mapBoolean, mapNullableString } from "@/lib/supabase/mappers/base";
import type { ContactType } from "@/shared/mocks/erp-data";

export type DbContactRow = {
  address?: string | null;
  email?: string | null;
  id: string;
  is_active?: boolean | null;
  name: string;
  notes?: string | null;
  phone?: string | null;
  tax_id?: string | null;
  type: ContactType;
  created_at?: string | null;
  updated_at?: string | null;
};

export function mapContact(row: DbContactRow) {
  return {
    ...mapBaseEntity(row),
    address: mapNullableString(row.address) ?? "",
    email: mapNullableString(row.email) ?? "",
    isActive: mapBoolean(row.is_active, true),
    name: row.name,
    phone: mapNullableString(row.phone) ?? "",
    taxId: mapNullableString(row.tax_id) ?? "",
    type: row.type,
  };
}
