"use client";

import { ArrowRight, History } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useId } from "react";

import { ClientApiError } from "@/shared/api/apiFetch";
import { usePermission } from "@/shared/auth/usePermission";
import { Badge } from "@/shared/components/Badge";
import { ErrorState } from "@/shared/components/ErrorState";
import { Skeleton } from "@/shared/components/Skeleton";
import { withReturnTo } from "@/shared/utils/returnTo";

import { useProductKardex } from "../hooks/useProductKardex";
import type { ProductKardex } from "../services/productKardex";
import {
  getInventoryStockStatus,
  type InventoryStockStatus,
  inventoryStockStatusLabels,
} from "../utils/inventoryStockStatus";
import { formatKardexDay, ProductKardexBalanceChart } from "./ProductKardexBalanceChart";
import { ProductMovementList } from "./ProductMovementList";

type ProductKardexCardProps = {
  productId: string;
  /** URL de la pantalla que monta la tarjeta: a ella vuelven el kardex completo y los documentos. */
  returnTo?: string;
};

const stockStatusBadgeVariant: Record<InventoryStockStatus, "danger" | "success" | "warning"> = {
  low: "warning",
  ok: "success",
  out: "danger",
};

/**
 * Kardex del producto: saldo actual, saldo diario de 30 días, entradas y
 * salidas del periodo y últimos movimientos. Un producto sin movimientos muestra
 * igual su saldo y el gráfico (línea plana); el vacío va solo en la lista. Solo
 * la ve quien tiene `inventory.view`; sin el permiso no se pinta ni consulta nada.
 */
export function ProductKardexCard({ productId, returnTo }: ProductKardexCardProps) {
  const { can, isLoading: isPermissionLoading } = usePermission();
  const canView = !isPermissionLoading && can("inventory.view");
  const kardex = useProductKardex(productId, canView);
  const headingId = useId();

  if (!canView) {
    return null;
  }

  const fullKardexHref = withReturnTo(
    `/inventory/movements?productId=${encodeURIComponent(productId)}`,
    returnTo,
  );
  const isForbidden = kardex.error instanceof ClientApiError && kardex.error.status === 403;

  return (
    <section
      aria-labelledby={headingId}
      className="overflow-hidden rounded-xl border border-border bg-surface-container-lowest shadow-sm dark:border-slate-800"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-bright px-5 py-4 dark:border-slate-800">
        <h2
          className="flex items-center gap-2 text-lg font-semibold text-foreground"
          id={headingId}
        >
          <History aria-hidden className="size-5 text-on-surface-variant" />
          Kardex
        </h2>
        {isForbidden ? null : (
          <Link
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            href={fullKardexHref}
          >
            Ver kardex completo
            <ArrowRight aria-hidden className="size-4" />
          </Link>
        )}
      </div>

      {isForbidden ? (
        <p className="px-5 py-8 text-center text-sm text-on-surface-variant">
          No tienes permiso para ver los movimientos de inventario.
        </p>
      ) : kardex.error ? (
        <div className="px-5 py-6">
          <ErrorState
            description={
              kardex.error instanceof Error
                ? kardex.error.message
                : "No pudimos cargar el kardex del producto."
            }
            onRetry={() => void kardex.refetch()}
            title="No pudimos cargar el kardex"
          />
        </div>
      ) : !kardex.data ? (
        <KardexSkeleton />
      ) : (
        <KardexContent kardex={kardex.data} returnTo={returnTo} />
      )}
    </section>
  );
}

function KardexSkeleton() {
  return (
    <div className="space-y-4 px-5 py-5">
      <p className="sr-only" role="status">
        Cargando kardex...
      </p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
      <Skeleton className="h-40" />
      <Skeleton className="w-2/3" variant="text" />
      <Skeleton className="w-1/2" variant="text" />
    </div>
  );
}

function KardexContent({ kardex, returnTo }: { kardex: ProductKardex; returnTo?: string }) {
  const { product } = kardex;
  const stockStatus = getInventoryStockStatus(product);
  const firstKnownDay = kardex.series.find((point) => point.balance !== null)?.date;
  // Truncado sin ningún día completo: los totales no se conocen, un 0 se leería como dato.
  const hasPeriodTotals = !kardex.truncated || firstKnownDay !== undefined;

  return (
    <>
      <dl className="grid grid-cols-2 gap-3 px-5 pt-5 lg:grid-cols-4">
        <KardexFigure label="Saldo actual">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-2xl font-bold tabular-nums text-foreground">
              {product.currentStock}
            </span>
            <Badge variant={stockStatusBadgeVariant[stockStatus]}>
              {inventoryStockStatusLabels[stockStatus]}
            </Badge>
          </span>
          <span className="mt-1 block text-xs text-on-surface-variant">
            Mínimo: {product.minStock}
          </span>
        </KardexFigure>
        <KardexFigure label="Entradas 30 d">
          <span className="text-2xl font-bold tabular-nums text-secondary">
            {hasPeriodTotals ? `+${kardex.entries30d}` : "—"}
          </span>
        </KardexFigure>
        <KardexFigure label="Salidas 30 d">
          <span className="text-2xl font-bold tabular-nums text-error">
            {!hasPeriodTotals ? "—" : kardex.exits30d === 0 ? "0" : `-${kardex.exits30d}`}
          </span>
        </KardexFigure>
        <KardexFigure label="Saldo hace 30 d">
          <span className="text-2xl font-bold tabular-nums text-foreground">
            {kardex.openingBalance ?? "—"}
          </span>
        </KardexFigure>
      </dl>

      {firstKnownDay ? (
        <div className="px-5 pt-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
            Saldo diario
          </h3>
          <ProductKardexBalanceChart series={kardex.series} />
        </div>
      ) : null}

      {kardex.truncated ? (
        <p className="px-5 pt-3 text-xs text-on-surface-variant" role="note">
          {firstKnownDay
            ? `Este producto tiene demasiados movimientos en 30 días: el gráfico y los totales cuentan desde el ${formatKardexDay(firstKnownDay)}.`
            : "Este producto tiene demasiados movimientos en 30 días para resumirlos aquí."}{" "}
          Abre el kardex completo para ver el resto.
        </p>
      ) : null}

      <h3 className="px-5 pt-5 pb-2 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
        Últimos movimientos
      </h3>
      {kardex.lastMovements.length === 0 ? (
        <p className="px-5 pt-2 pb-6 text-center text-sm text-on-surface-variant">
          Este producto aún no tiene movimientos.
        </p>
      ) : (
        <ProductMovementList movements={kardex.lastMovements} returnTo={returnTo} />
      )}
    </>
  );
}

function KardexFigure({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-surface-container-low p-3 dark:border-slate-800">
      <dt className="text-xs font-medium text-on-surface-variant">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}
