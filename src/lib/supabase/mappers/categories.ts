import { mapBaseEntity, mapBoolean, mapNullableString } from "./base";

export type CategoryRow = {
  description?: string | null;
  id: string;
  is_active?: boolean | null;
  name: string;
};

export function mapCategory(row: CategoryRow) {
  return {
    ...mapBaseEntity(row),
    description: mapNullableString(row.description),
    isActive: mapBoolean(row.is_active, true),
    name: row.name,
  };
}
