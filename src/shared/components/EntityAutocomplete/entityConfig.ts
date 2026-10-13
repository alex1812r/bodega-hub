import type { ContactType } from "@/shared/mocks/erp-data";
import { formatRefUsd } from "@/shared/utils/currency";

import type {
  EntityFetcher,
  EntityFilters,
  EntityKind,
  EntityOption,
} from "./entityAutocomplete.types";
import { fetchContactEntityOptions, fetchProductEntityOptions } from "./entityFetchers";

/** De dónde sale una opción: del servidor o de los recientes del navegador. */
export type EntityOptionSource = "recents" | "results";

export type EntitySecondaryContext = {
  /** La opción viene de los recientes guardados, no de una búsqueda en servidor. */
  isRecent: boolean;
};

type EntityConfig<K extends EntityKind> = {
  defaultFetcher: EntityFetcher<K>;
  defaultPlaceholder: string;
  /**
   * Coincidencia exacta de código (sin distinguir mayúsculas ni espacios
   * alrededor) para el Enter del lector de barras.
   */
  findExact: (options: EntityOption<K>[], text: string) => EntityOption<K> | undefined;
  getSecondary: (option: EntityOption<K>, context: EntitySecondaryContext) => string;
  matchesFilters: (
    option: EntityOption<K>,
    filters: EntityFilters<K>,
    source: EntityOptionSource,
  ) => boolean;
};

const contactTypeLabels: Record<ContactType, string> = {
  ambos: "Ambos",
  cliente: "Cliente",
  proveedor: "Proveedor",
};

function matchesActiveFilter(option: { isActive: boolean }, filters: { active?: boolean }) {
  return filters.active === undefined || option.isActive === filters.active;
}

function isExcluded(option: { id: string }, filters: { excludeIds?: string[] }) {
  return filters.excludeIds?.includes(option.id) ?? false;
}

function normalizeCode(code: string | null) {
  return (code ?? "").trim().toLowerCase();
}

function joinSecondary(parts: string[]) {
  return parts.filter(Boolean).join(" · ");
}

export const entityConfig: { [K in EntityKind]: EntityConfig<K> } = {
  contact: {
    defaultFetcher: fetchContactEntityOptions,
    defaultPlaceholder: "Buscar por nombre o RIF",
    findExact: (options, text) => {
      const code = normalizeCode(text);

      return code ? options.find((option) => normalizeCode(option.taxId) === code) : undefined;
    },
    getSecondary: (option) => joinSecondary([contactTypeLabels[option.type], option.phone]),
    // `isActive` de los resultados lo aplica el BFF; un reciente es una copia
    // guardada en el navegador y hay que filtrarla aquí.
    matchesFilters: (option, filters, source) =>
      (source === "results" || matchesActiveFilter(option, filters)) &&
      !isExcluded(option, filters) &&
      (!filters.type || filters.type.length === 0 || filters.type.includes(option.type)),
  },
  product: {
    defaultFetcher: fetchProductEntityOptions,
    defaultPlaceholder: "Buscar por nombre, SKU o código de barras",
    findExact: (options, text) => {
      const code = normalizeCode(text);

      if (!code) {
        return undefined;
      }

      return (
        options.find((option) => normalizeCode(option.barcode) === code) ??
        options.find((option) => normalizeCode(option.sku) === code)
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
      matchesActiveFilter(option, filters) &&
      !isExcluded(option, filters) &&
      (!filters.categoryId || option.categoryId === filters.categoryId),
  },
};
