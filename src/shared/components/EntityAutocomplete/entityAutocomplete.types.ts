import type { ContactType } from "@/shared/mocks/erp-data";

export type EntityKind = "contact" | "product";

export type ProductEntityOption = {
  barcode: string | null;
  categoryId: string;
  currentCostRef: number;
  currentStock: number;
  id: string;
  isActive: boolean;
  label: string;
  salePriceRef: number;
  sku: string;
};

export type ContactEntityOption = {
  id: string;
  isActive: boolean;
  label: string;
  phone: string;
  taxId: string;
  type: ContactType;
};

export type EntityOptionMap = {
  contact: ContactEntityOption;
  product: ProductEntityOption;
};

export type EntityOption<K extends EntityKind = EntityKind> = EntityOptionMap[K];

/** Valor controlado mínimo: basta con `id` y `label` para mostrar la selección. */
export type EntityAutocompleteValue = {
  id: string;
  label: string;
};

type CommonEntityFilters = {
  /** `true` solo activos, `false` solo inactivos; sin definir, todos. */
  active?: boolean;
  /** Ids que no deben ofrecerse (p. ej. los ya agregados al documento). */
  excludeIds?: string[];
};

export type ProductEntityFilters = CommonEntityFilters & {
  categoryId?: string;
};

export type ContactEntityFilters = CommonEntityFilters & {
  /** Tipos admitidos, p. ej. `["proveedor", "ambos"]`. */
  type?: ContactType[];
};

export type EntityFiltersMap = {
  contact: ContactEntityFilters;
  product: ProductEntityFilters;
};

export type EntityFilters<K extends EntityKind = EntityKind> = EntityFiltersMap[K];

export type EntityFetcherParams<K extends EntityKind = EntityKind> = {
  /**
   * `true` cuando la búsqueda la dispara Enter (lector de barras): el fetcher
   * debe garantizar que una coincidencia exacta de código venga en la respuesta.
   */
  exact: boolean;
  filters: EntityFilters<K>;
  limit: number;
  query: string;
  signal: AbortSignal;
};

export type EntityFetcher<K extends EntityKind = EntityKind> = (
  params: EntityFetcherParams<K>,
) => Promise<EntityOption<K>[]>;
