import { MAX_PAGE_LIMIT, type PaginatedList } from "@/lib/api/pagination";
import { apiFetch } from "@/shared/api/apiFetch";
import type { ContactMock, ContactType, ProductMock } from "@/shared/mocks/erp-data";

import type {
  ContactEntityOption,
  EntityFetcher,
  ProductEntityOption,
} from "./entityAutocomplete.types";

export function toProductEntityOption(product: ProductMock): ProductEntityOption {
  return {
    barcode: product.barcode ?? null,
    categoryId: product.categoryId,
    currentCostRef: product.currentCostRef,
    currentStock: product.currentStock,
    id: product.id,
    isActive: product.isActive,
    label: product.name,
    salePriceRef: product.salePriceRef,
    sku: product.sku,
  };
}

export function toContactEntityOption(contact: ContactMock): ContactEntityOption {
  return {
    id: contact.id,
    isActive: contact.isActive,
    label: contact.name,
    phone: contact.phone ?? "",
    taxId: contact.taxId ?? "",
    type: contact.type,
  };
}

/** Pide margen para los excluidos en cliente sin pasar del tope del BFF. */
function pageLimit(limit: number, excludeIds: string[] | undefined) {
  return Math.min(MAX_PAGE_LIMIT, limit + (excludeIds?.length ?? 0));
}

/**
 * `GET /api/contacts?type=` solo admite un valor: `proveedor` y `cliente` ya
 * incluyen `ambos` en servidor. El resto de combinaciones se afina en cliente.
 */
export function toContactTypeParam(types: ContactType[] | undefined): ContactType | undefined {
  if (!types || types.length === 0) {
    return undefined;
  }

  const wantsSupplier = types.includes("proveedor");
  const wantsCustomer = types.includes("cliente");

  if (wantsSupplier && wantsCustomer) {
    return undefined;
  }

  if (wantsSupplier) {
    return "proveedor";
  }

  return wantsCustomer ? "cliente" : "ambos";
}

/** Busca productos en `GET /api/products` por nombre, SKU o código de barras. */
export const fetchProductEntityOptions: EntityFetcher<"product"> = async ({
  exact,
  filters,
  limit,
  query,
  signal,
}) => {
  const baseQuery = {
    categoryId: filters.categoryId,
    isActive: filters.active,
    limit: pageLimit(limit, filters.excludeIds),
    skip: 0,
  };
  const searchRequest = apiFetch<PaginatedList<ProductMock>>("/api/products", {
    query: { ...baseQuery, search: query },
    signal,
  });

  if (!exact) {
    return (await searchRequest).items.map(toProductEntityOption);
  }

  // Lector de barras: `barcode` y `sku` son igualdad exacta en servidor, así
  // la coincidencia llega aunque la búsqueda parcial devuelva más de una página.
  const [byBarcode, bySku, bySearch] = await Promise.all([
    apiFetch<PaginatedList<ProductMock>>("/api/products", {
      query: { ...baseQuery, barcode: query },
      signal,
    }),
    apiFetch<PaginatedList<ProductMock>>("/api/products", {
      query: { ...baseQuery, sku: query },
      signal,
    }),
    searchRequest,
  ]);
  const seen = new Set<string>();

  return [...byBarcode.items, ...bySku.items, ...bySearch.items]
    .filter((product) => {
      if (seen.has(product.id)) {
        return false;
      }

      seen.add(product.id);
      return true;
    })
    .map(toProductEntityOption);
};

/**
 * Busca contactos en `GET /api/contacts` por nombre, RIF o teléfono. El BFF
 * aplica `isActive`, así que la página llega ya filtrada por estado.
 */
export const fetchContactEntityOptions: EntityFetcher<"contact"> = async ({
  filters,
  limit,
  query,
  signal,
}) => {
  const page = await apiFetch<PaginatedList<ContactMock>>("/api/contacts", {
    query: {
      isActive: filters.active,
      limit: pageLimit(limit, filters.excludeIds),
      search: query,
      skip: 0,
      type: toContactTypeParam(filters.type),
    },
    signal,
  });

  return page.items.map(toContactEntityOption);
};
