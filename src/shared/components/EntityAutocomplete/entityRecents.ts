import type {
  ContactEntityOption,
  EntityKind,
  EntityOption,
  ProductEntityOption,
} from "./entityAutocomplete.types";

export const MAX_ENTITY_RECENTS = 8;

const STORAGE_PREFIX = "bodega-hub:entity-autocomplete:recents";
const CONTACT_TYPES = ["ambos", "cliente", "proveedor"];

export function getEntityRecentsStorageKey(entity: EntityKind, recentsKey?: string) {
  return recentsKey ? `${STORAGE_PREFIX}:${entity}:${recentsKey}` : `${STORAGE_PREFIX}:${entity}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isProductOption(value: unknown): value is ProductEntityOption {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    typeof value.sku === "string" &&
    (value.barcode === null || typeof value.barcode === "string") &&
    typeof value.categoryId === "string" &&
    typeof value.currentCostRef === "number" &&
    typeof value.currentStock === "number" &&
    typeof value.salePriceRef === "number" &&
    typeof value.isActive === "boolean"
  );
}

function isContactOption(value: unknown): value is ContactEntityOption {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    typeof value.phone === "string" &&
    typeof value.taxId === "string" &&
    typeof value.type === "string" &&
    CONTACT_TYPES.includes(value.type) &&
    typeof value.isActive === "boolean"
  );
}

const optionGuards: { [K in EntityKind]: (value: unknown) => value is EntityOption<K> } = {
  contact: isContactOption,
  product: isProductOption,
};

/** Lee los recientes; devuelve `[]` si el storage está bloqueado o corrupto. */
export function readEntityRecents<K extends EntityKind>(
  entity: K,
  recentsKey?: string,
): EntityOption<K>[] {
  try {
    const raw = window.localStorage.getItem(getEntityRecentsStorageKey(entity, recentsKey));
    const parsed: unknown = raw ? JSON.parse(raw) : [];

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(optionGuards[entity]).slice(0, MAX_ENTITY_RECENTS);
  } catch {
    return [];
  }
}

/** Pone `option` al frente de los recientes; ignora un storage bloqueado o lleno. */
export function rememberEntityRecent<K extends EntityKind>(
  entity: K,
  option: EntityOption<K>,
  recentsKey?: string,
) {
  const next = [
    option,
    ...readEntityRecents(entity, recentsKey).filter((recent) => recent.id !== option.id),
  ].slice(0, MAX_ENTITY_RECENTS);

  try {
    window.localStorage.setItem(
      getEntityRecentsStorageKey(entity, recentsKey),
      JSON.stringify(next),
    );
  } catch {
    // Sin storage no hay recientes; la selección sigue funcionando.
  }
}
