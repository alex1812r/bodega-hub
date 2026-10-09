"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { getPaginatedItems } from "@/lib/api/pagination";
import { ClientApiError } from "@/shared/api/apiFetch";
import { ErrorState } from "@/shared/components/ErrorState";
import { Skeleton } from "@/shared/components/Skeleton";

import { ProductMovementList } from "../../components/ProductMovementList";
import { useInventoryMovements, type InventoryOverviewItem } from "../../hooks/useInventory";
import { withChainedReturnTo } from "../../utils/chainedReturnTo";

/** Movimientos que muestra el panel: los últimos del producto. */
export const INVENTORY_PANEL_MOVEMENTS = 10;

type InventoryProductMovementsPanelProps = {
  /** `id` del panel: el botón que lo abre lo referencia con `aria-controls`. */
  id: string;
  product: Pick<InventoryOverviewItem, "currentStock" | "id" | "name" | "reconciliationDiff">;
  /**
   * URL de la lista con `product=<id>`: a ella vuelven el kardex completo (con el
   * `returnTo` que traiga la lista) y los documentos.
   */
  returnTo: string;
};

/**
 * Kardex en línea de un producto de `/inventory`: stock actual y sus últimos
 * movimientos con el saldo tras cada uno. Pide los movimientos al montarse, así
 * que la lista no consulta nada hasta que se expande una fila.
 */
export function InventoryProductMovementsPanel({
  id,
  product,
  returnTo,
}: InventoryProductMovementsPanelProps) {
  const movementsQuery = useInventoryMovements({
    limit: INVENTORY_PANEL_MOVEMENTS,
    productId: product.id,
  });
  const movements = getPaginatedItems(movementsQuery.data);
  const isForbidden =
    movementsQuery.error instanceof ClientApiError && movementsQuery.error.status === 403;
  // Solo el admin recibe el campo; `null` y 0 = el stock cuadra con el libro.
  const reconciliationDiff = product.reconciliationDiff ?? 0;

  return (
    <div
      aria-label={`Últimos movimientos de ${product.name}`}
      className="min-w-0 bg-surface-container-low text-left dark:bg-slate-950"
      id={id}
      role="region"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 pt-3">
        <p className="text-sm text-on-surface-variant">
          Stock actual:{" "}
          <span className="font-semibold tabular-nums text-foreground">{product.currentStock}</span>
        </p>
        {isForbidden ? null : (
          <Link
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            href={withChainedReturnTo(
              `/inventory/movements?productId=${encodeURIComponent(product.id)}`,
              returnTo,
            )}
          >
            Ver kardex completo
            <ArrowRight aria-hidden className="size-4" />
          </Link>
        )}
      </div>

      {reconciliationDiff !== 0 ? (
        <p className="px-5 pt-1 text-xs font-medium text-error" role="note">
          El stock ({product.currentStock}) no coincide con la suma de movimientos (
          {product.currentStock - reconciliationDiff}).
        </p>
      ) : null}

      {isForbidden ? (
        <p className="px-5 py-6 text-center text-sm text-on-surface-variant">
          No tienes permiso para ver los movimientos de inventario.
        </p>
      ) : movementsQuery.error ? (
        <ErrorState
          description={movementsQuery.error.message}
          onRetry={() => void movementsQuery.refetch()}
          title="No pudimos cargar los movimientos"
        />
      ) : !movementsQuery.data ? (
        <div className="space-y-2 px-5 py-4">
          <p className="sr-only" role="status">
            Cargando movimientos...
          </p>
          <Skeleton className="w-2/3" variant="text" />
          <Skeleton className="w-1/2" variant="text" />
          <Skeleton className="w-3/5" variant="text" />
        </div>
      ) : movements.length === 0 ? (
        <p className="px-5 py-6 text-center text-sm text-on-surface-variant">
          Este producto aún no tiene movimientos.
        </p>
      ) : (
        <div className="pt-1">
          <ProductMovementList movements={movements} returnTo={returnTo} />
        </div>
      )}
    </div>
  );
}
