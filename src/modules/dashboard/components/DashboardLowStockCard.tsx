"use client";

import { AlertTriangle, Package } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/shared/components/Button";
import { LoadingState } from "@/shared/components/LoadingState";
import { cn } from "@/shared/utils/cn";

import {
  type DashboardRequestScope,
  useDashboardLowStock,
} from "../hooks/useDashboard";

const LOW_STOCK_LIMIT = 8;

type DashboardLowStockCardProps = {
  footer?: ReactNode;
  scope?: DashboardRequestScope;
  showStore?: boolean;
  totalCount: number;
};

export function DashboardLowStockCard({
  footer,
  scope,
  showStore = false,
  totalCount,
}: DashboardLowStockCardProps) {
  const lowStock = useDashboardLowStock({ limit: LOW_STOCK_LIMIT, skip: 0 }, scope);
  const products = lowStock.data?.items ?? [];

  return (
    <div className="flex h-full flex-col rounded-xl border border-border bg-surface-container-lowest shadow-sm">
      <div className="flex items-center justify-between gap-3 rounded-t-xl border-b border-border/50 bg-surface-container-low/50 p-5">
        <div className="flex items-center gap-2">
          <AlertTriangle aria-hidden className="h-5 w-5 text-red-600" />
          <h2 className="text-lg font-semibold text-foreground">Bajo stock</h2>
        </div>
        {totalCount > 0 ? (
          <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-medium text-white">
            {totalCount} items
          </span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {lowStock.isLoading ? (
          <div className="p-4">
            <LoadingState
              description="Productos por debajo del minimo configurado."
              title="Cargando inventario"
              variant="inline"
            />
          </div>
        ) : lowStock.error ? (
          <p className="p-4 text-sm text-red-600">No pudimos cargar el listado de bajo stock.</p>
        ) : products.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            No hay productos por debajo del minimo configurado.
          </p>
        ) : (
          <ul className="space-y-1">
            {products.map((product) => {
              const isCritical = product.currentStock < product.minStock;

              return (
                <li
                  className="flex items-center justify-between gap-3 rounded-lg border border-transparent p-3 transition-colors hover:border-border/30 hover:bg-surface-container-low"
                  key={product.id}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-surface-container text-muted-foreground">
                      <Package aria-hidden className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{product.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {product.sku}
                        {showStore && product.storeName ? ` · ${product.storeName}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span
                      className={cn(
                        "block text-sm font-medium",
                        isCritical ? "text-red-600" : "text-amber-600",
                      )}
                    >
                      {product.currentStock} unds
                    </span>
                    <span className="text-xs text-muted-foreground">Min: {product.minStock}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="border-t border-border/50 p-4">
        {footer ?? (
          <Button asChild className="w-full" variant="secondary">
            <Link href="/purchases/create">Generar orden de compra</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
