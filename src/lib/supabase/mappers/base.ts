export type DbTimestamps = {
  created_at?: string | null;
  updated_at?: string | null;
};

export type DbRowWithId = {
  id: string;
} & DbTimestamps;

export function mapTimestamps(row: DbTimestamps) {
  return {
    createdAt: row.created_at ?? undefined,
    updatedAt: row.updated_at ?? undefined,
  };
}

export function mapBaseEntity(row: DbRowWithId) {
  return {
    id: row.id,
    ...mapTimestamps(row),
  };
}

export function mapNullableString(value: string | null | undefined) {
  return value ?? undefined;
}

export function mapBoolean(value: boolean | null | undefined, fallback = false) {
  return value ?? fallback;
}
