import type { ContactType } from "@/shared/mocks/erp-data";
import { formatRefUsd } from "@/shared/utils/currency";

import type {
  EntityFetcher,
  EntityFilters,
  EntityKind,
  EntityOption,
} from "./entityAutocomplete.types";
import { fetchContactEntityOptions, fetchProductEntityOptions } from "./entityFetchers";

export type EntitySecondaryContext = {
  /** La opción viene de los recientes guardados, no de una búsqueda en servidor. */
  isRecent: boolean;
};

type EntityConfig<K extends EntityKind> = {
  defaultFetcher: EntityFetcher<K>;
  defaultPlaceholder: string;
  /** Coincidencia exacta de código para el Enter del lector de barras. */
  findExact: (options: EntityOption<K>[], text: string) => EntityOption<K> | undefined;
  getSecondary: (option: EntityOption<K>, context: EntitySecondaryContext) => string;
  matchesFilters: (option: EntityOption<K>, filters: EntityFilters<K>) => boolean;
};

const contactTypeLabels: Record<ContactType, string> = {
  ambos: "Ambos",
  cliente: "Cliente",
  proveedor: "Proveedor",
};

function matchesCommonFilters(
  option: { id: string; isActive: boolean },
  filters: { active?: boolean; excludeIds?: string[] },
) {
  if (filters.active !== undefined && option.isActive !== filters.active) {
    return false;
  }

  return !filters.excludeIds?.includes(option.id);
}

function joinSecondary(parts: string[]) {
  return parts.filter(Boolean).join(" · ");
}

export const entityConfig: { [K in EntityKind]: EntityConfig<K> } = {
  contact: {
    defaultFetcher: fetchContactEntityOptions,
    defaultPlaceholder: "Buscar por nombre o RIF",
    findExact: () => undefined,
    getSecondary: (option) => joinSecondary([contactTypeLabels[option.type], option.phone]),
    matchesFilters: (option, filters) =>
      matchesCommonFilters(option, filters) &&
      (!filters.type || filters.type.length === 0 || filters.type.includes(option.type)),
  },
  product: {
    defaultFetcher: fetchProductEntityOptions,
    defaultPlaceholder: "Buscar por nombre, SKU o código de barras",
    findExact: (options, text) => {
      const code = text.trim();
      const lowerCode = code.toLowerCase();

      return (
        options.find((option) => option.barcode === code) ??
        options.find((option) => option.sku.toLowerCase() === lowerCode)
      );
    },
    // El stock y el precio de un reciente pueden estar desactualizados: solo SKU.
    getSecondary: (option, { isRecent }) =>
      isRecent
        ? option.sku
        : joinSecondary([
            option.sku,
            `Stock ${option.currentStock}`,
            formatRefUsd(option.salePriceRef),
          ]),
    matchesFilters: (option, filters) =>
      matchesCommonFilters(option, filters) &&
      (!filters.categoryId || option.categoryId === filters.categoryId),
  },
};
