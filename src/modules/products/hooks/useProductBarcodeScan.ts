"use client";

import { useCallback, useState } from "react";

import type { PaginatedList } from "@/lib/api/pagination";
import { apiFetch } from "@/shared/api/apiFetch";

import type { ProductWithCategory } from "./useProducts";

export type ProductBarcodeScanFilters = {
  isActive?: boolean;
};

export type ProductBarcodeScanCallbacks = {
  onAmbiguous?: () => void;
  onNotFound?: (message: string) => void;
  onResolved: (product: ProductWithCategory) => void;
};

export async function fetchProductByBarcode(
  code: string,
  filters: ProductBarcodeScanFilters = {},
): Promise<ProductWithCategory | null> {
  const trimmed = code.trim();
  if (!trimmed) {
    return null;
  }

  const result = await apiFetch<PaginatedList<ProductWithCategory>>("/api/products", {
    query: {
      barcode: trimmed,
      isActive: filters.isActive ?? true,
      limit: 2,
    },
  });

  if (result.items.length === 0) {
    return null;
  }

  if (result.items.length > 1) {
    throw new Error("MULTIPLE_BARCODE_MATCHES");
  }

  return result.items[0] ?? null;
}

export function useProductBarcodeScan(filters: ProductBarcodeScanFilters = {}) {
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const clearScanError = useCallback(() => {
    setScanError(null);
  }, []);

  const handleScanSubmit = useCallback(
    async (code: string, callbacks: ProductBarcodeScanCallbacks) => {
      const trimmed = code.trim();
      if (!trimmed) {
        return;
      }

      setIsLookingUp(true);
      setScanError(null);

      try {
        const result = await apiFetch<PaginatedList<ProductWithCategory>>("/api/products", {
          query: {
            barcode: trimmed,
            isActive: filters.isActive ?? true,
            limit: 2,
          },
        });

        if (result.items.length === 0) {
          const message = "No se encontro producto con ese codigo de barras.";
          setScanError(message);
          callbacks.onNotFound?.(message);
          return;
        }

        if (result.items.length > 1) {
          const message = "Hay mas de un producto con ese codigo de barras.";
          setScanError(message);
          callbacks.onAmbiguous?.();
          callbacks.onNotFound?.(message);
          return;
        }

        const product = result.items[0];
        if (product) {
          callbacks.onResolved(product);
        }
      } catch {
        const message = "No se pudo buscar el producto escaneado.";
        setScanError(message);
        callbacks.onNotFound?.(message);
      } finally {
        setIsLookingUp(false);
      }
    },
    [filters.isActive],
  );

  return {
    clearScanError,
    handleScanSubmit,
    isLookingUp,
    scanError,
    setScanError,
  };
}
