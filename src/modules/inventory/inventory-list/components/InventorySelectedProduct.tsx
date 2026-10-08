"use client";

import { type ReactNode } from "react";

import { Button } from "@/shared/components/Button";
import { Skeleton } from "@/shared/components/Skeleton";

import type { InventoryOverviewItem } from "../../hooks/useInventory";
import { InventoryLastMovementCell } from "./InventoryLastMovementCell";
import {
  getInventoryMovementsPanelId,
  getInventoryProductAnchorId,
} from "./InventoryMovementsToggle";
import { InventoryProductMovementsPanel } from "./InventoryProductMovementsPanel";
import { InventorySkuCell } from "./InventorySkuCell";
import { InventoryProductName, InventoryStockValue } from "./InventoryStockCells";
import { InventoryStockStatusBadge } from "./InventoryStockStatusBadge";

const HEADING = "Producto seleccionado";

type InventorySelectedProductProps = {
  /** La consulta del producto falló por algo que no es "no existe". */
  error?: Error | null;
  /** `undefined` con `isLoading` = cargando; `null` = no existe o es de otra tienda. Un inactivo sí llega. */
  item: InventoryOverviewItem | null | undefined;
  isLoading: boolean;
  /** Quita `product` de la URL. */
  onClear: () => void;
  onRetry: () => void;
  productId: string;
  /** URL de la lista con `product=<id>`, para volver desde el kardex completo. */
  returnTo: string;
};

function Figure({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-on-surface-variant">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium tabular-nums text-foreground">{children}</dd>
    </div>
  );
}

/** Aviso de una línea con su acción, cuando no hay producto que mostrar. */
function Notice({ actions, children }: { actions: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
      <p className="min-w-0 text-sm text-on-surface-variant">{children}</p>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  );
}

/**
 * Producto de `?product=<id>` que no está en la página visible de `/inventory`
 * (enlace desde Productos, o cambió el filtro o la página): se fija encima de la
 * tabla con los mismos datos que una fila y sus últimos movimientos abiertos.
 */
export function InventorySelectedProduct({
  error,
  isLoading,
  item,
  onClear,
  onRetry,
  productId,
  returnTo,
}: InventorySelectedProductProps) {
  const clearButton = (
    <Button onClick={onClear} size="sm" variant="outline">
      Quitar selección
    </Button>
  );

  return (
    <section
      aria-label={HEADING}
      className="min-w-0 overflow-hidden rounded-xl border border-border bg-surface-container-lowest shadow-sm dark:border-slate-800"
      id={getInventoryProductAnchorId(productId)}
    >
      {item ? (
        <>
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pt-3">
            <div className="flex min-w-0 flex-col gap-1">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                {HEADING}
              </h2>
              <div className="font-medium">
                <InventoryProductName item={item} />
              </div>
              {item.isActive ? null : (
                <span
                  className="inline-flex w-fit items-center rounded-full border border-border bg-surface-container px-2 py-0.5 text-xs font-semibold text-on-surface-variant"
                  title="Producto inactivo: conserva su stock y su historial"
                >
                  Inactivo
                </span>
              )}
              <InventorySkuCell sku={item.sku} />
            </div>
            {clearButton}
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3 sm:grid-cols-3 lg:grid-cols-6">
            <Figure label="Stock">
              <InventoryStockValue currentStock={item.currentStock} />
            </Figure>
            <Figure label="Mínimo">{item.minStock}</Figure>
            <Figure label="Entradas 30 d">{item.entries30d}</Figure>
            <Figure label="Salidas 30 d">{item.exits30d}</Figure>
            <Figure label="Último movimiento">
              <InventoryLastMovementCell at={item.lastMovementAt} type={item.lastMovementType} />
            </Figure>
            <Figure label="Estado">
              <InventoryStockStatusBadge currentStock={item.currentStock} minStock={item.minStock} />
            </Figure>
          </dl>
          <div className="border-t border-border dark:border-slate-800">
            <InventoryProductMovementsPanel
              id={getInventoryMovementsPanelId(item.id)}
              product={item}
              returnTo={returnTo}
            />
          </div>
        </>
      ) : isLoading ? (
        <div className="space-y-2 px-4 py-3">
          <p className="sr-only" role="status">
            Cargando el producto seleccionado...
          </p>
          <Skeleton className="w-1/3" variant="text" />
          <Skeleton className="w-2/3" variant="text" />
        </div>
      ) : error ? (
        <Notice
          actions={
            <>
              <Button onClick={onRetry} size="sm" variant="outline">
                Reintentar
              </Button>
              {clearButton}
            </>
          }
        >
          No pudimos cargar el producto seleccionado. {error.message}
        </Notice>
      ) : (
        <Notice actions={clearButton}>No se encontró el producto seleccionado.</Notice>
      )}
    </section>
  );
}
