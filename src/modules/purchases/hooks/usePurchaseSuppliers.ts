"use client";

import { useQuery } from "@tanstack/react-query";

import type { PaginatedList } from "@/lib/api/pagination";
import type { PurchaseSupplier } from "@/modules/purchases/services/purchaseSuppliers.mock-server";
import { apiFetch } from "@/shared/api/apiFetch";
import type { ContactEntityOption, EntityFetcher } from "@/shared/components/EntityAutocomplete";

const PURCHASE_SUPPLIERS_PATH = "/api/purchases/suppliers";
/** Tope de `limit` de `GET /api/purchases/suppliers`. */
const PURCHASE_SUPPLIERS_MAX_LIMIT = 20;

export const purchaseSuppliersQueryKeys = {
  all: ["purchase-suppliers"] as const,
  detail: (id: string) => [...purchaseSuppliersQueryKeys.all, "detail", id] as const,
};

/**
 * El endpoint solo entrega proveedores (`proveedor` o `ambos`) y no dice cuál ni
 * su teléfono: la opción va como `proveedor` y sin teléfono.
 */
function toSupplierEntityOption(supplier: PurchaseSupplier): ContactEntityOption {
  return {
    id: supplier.id,
    isActive: supplier.isActive,
    label: supplier.name,
    phone: "",
    taxId: supplier.taxId,
    type: "proveedor",
  };
}

/**
 * Busca proveedores activos por nombre o RIF en `GET /api/purchases/suppliers`
 * (permiso `purchases.create`). Para un `EntityAutocomplete` de `entity="contact"`.
 */
export const fetchPurchaseSupplierOptions: EntityFetcher<"contact"> = async ({
  limit,
  query,
  signal,
}) => {
  const page = await apiFetch<PaginatedList<PurchaseSupplier>>(PURCHASE_SUPPLIERS_PATH, {
    query: { limit: Math.min(limit, PURCHASE_SUPPLIERS_MAX_LIMIT), search: query },
    signal,
  });

  return page.items.map(toSupplierEntityOption);
};

/** Un proveedor por id, activo o no, para mostrar el nombre de uno ya elegido. */
export function usePurchaseSupplier(id?: string) {
  return useQuery({
    enabled: Boolean(id),
    queryKey: purchaseSuppliersQueryKeys.detail(id ?? ""),
    queryFn: () => apiFetch<PurchaseSupplier>(PURCHASE_SUPPLIERS_PATH, { query: { id } }),
  });
}
