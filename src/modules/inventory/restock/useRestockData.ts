"use client";

import { useInfiniteQuery, useQueries } from "@tanstack/react-query";
import { useMemo } from "react";

import type { PaginatedList } from "@/lib/api/pagination";
import { apiFetch } from "@/shared/api/apiFetch";
import { usePermission } from "@/shared/auth/usePermission";

import { inventoryQueryKeys, type InventoryOverviewItem } from "../hooks/useInventory";
import type { RestockDraftSession } from "./restockDraft";
import {
  pickRestockSupplier,
  type RestockSupplierChoice,
  type RestockSupplierLink,
} from "./restockPlan";

/** Productos por reponer que se piden cada vez (`GET /api/inventory?lowStock=true`). */
export const RESTOCK_PAGE_SIZE = 50;
/** Consultas de proveedores (`GET /api/products/{id}/suppliers`) a la vez. */
export const RESTOCK_SUPPLIER_CONCURRENCY = 4;
/** Un producto admite como máximo 50 proveedores: 100 los trae todos en una llamada. */
const SUPPLIER_LINKS_LIMIT = 100;
const SUPPLIERS_STALE_MS = 60_000;

/** Ejecuta como mucho `max` tareas a la vez; el resto espera su turno en orden de llegada. */
export function createConcurrencyLimiter(max: number) {
  const queue: Array<() => void> = [];
  let running = 0;

  function next() {
    if (running >= max) {
      return;
    }

    const start = queue.shift();

    if (start) {
      running += 1;
      start();
    }
  }

  return function limit<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        task()
          .then(resolve, reject)
          .finally(() => {
            running -= 1;
            next();
          });
      });
      next();
    });
  };
}

const limitSupplierRequests = createConcurrencyLimiter(RESTOCK_SUPPLIER_CONCURRENCY);

export const restockQueryKeys = {
  candidates: () => [...inventoryQueryKeys.all, "restock", "candidates"] as const,
  suppliers: (productId: string) =>
    [...inventoryQueryKeys.all, "restock", "suppliers", productId] as const,
};

/**
 * Productos activos con stock bajo o agotado, de `RESTOCK_PAGE_SIZE` en
 * `RESTOCK_PAGE_SIZE`: `fetchNextPage` trae los siguientes mientras el total del
 * servidor sea mayor que lo cargado.
 */
export function useRestockCandidates(enabled = true) {
  return useInfiniteQuery({
    enabled,
    getNextPageParam: (lastPage: PaginatedList<InventoryOverviewItem>, pages) => {
      const loaded = pages.reduce((sum, page) => sum + page.items.length, 0);

      return lastPage.items.length > 0 && loaded < lastPage.total ? loaded : undefined;
    },
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      apiFetch<PaginatedList<InventoryOverviewItem>>("/api/inventory", {
        query: { limit: RESTOCK_PAGE_SIZE, lowStock: true, skip: pageParam },
      }),
    queryKey: restockQueryKeys.candidates(),
  });
}

export type RestockSupplierState =
  | { retry: () => void; status: "error" }
  | { status: "loading" }
  | { status: "ready"; supplier: RestockSupplierChoice | null };

/**
 * Proveedor de cada producto SELECCIONADO. No hay forma de pedir el proveedor
 * habitual de una lista de ids con los endpoints actuales (`GET /api/products`
 * no filtra por ids), así que se consulta `GET /api/products/{id}/suppliers`
 * solo para lo seleccionado, con tope de concurrencia y caché por producto.
 */
export function useRestockSuppliers(productIds: readonly string[]) {
  const results = useQueries({
    queries: productIds.map((productId) => ({
      queryFn: () =>
        limitSupplierRequests(() =>
          apiFetch<PaginatedList<RestockSupplierLink>>(`/api/products/${productId}/suppliers`, {
            query: { isActive: true, limit: SUPPLIER_LINKS_LIMIT },
          }),
        ),
      queryKey: restockQueryKeys.suppliers(productId),
      staleTime: SUPPLIERS_STALE_MS,
    })),
  });

  const states = new Map<string, RestockSupplierState>();

  productIds.forEach((productId, index) => {
    const result = results[index];

    if (result.data) {
      states.set(productId, {
        status: "ready",
        supplier: pickRestockSupplier(result.data.items),
      });
    } else if (result.error) {
      states.set(productId, { retry: () => void result.refetch(), status: "error" });
    } else {
      states.set(productId, { status: "loading" });
    }
  });

  return states;
}

/** Tienda y usuario de la sesión, para firmar la precarga; `null` mientras el usuario no ha cargado. */
export function useRestockSession(): RestockDraftSession | null {
  const { profile } = usePermission();
  const storeId = profile?.storeId ?? null;
  const userId = profile?.user?.id;

  return useMemo(() => (userId ? { storeId, userId } : null), [storeId, userId]);
}
