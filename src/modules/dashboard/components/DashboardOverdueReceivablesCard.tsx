"use client";

import { ArrowRight, Clock } from "lucide-react";
import Link from "next/link";

import { MIN_PAGE_LIMIT } from "@/lib/api/pagination";
import { useReceivablesAgingReport } from "@/modules/reports/hooks/useMoneyReports";
import {
  assertMoneyReportAccess,
  type AgingBucket,
  type AgingBucketSummary,
} from "@/modules/reports/services/moneyReports";
import type { Permission, UserRole } from "@/shared/auth/permissions";
import { usePermission } from "@/shared/auth/usePermission";
import { cn } from "@/shared/utils/cn";
import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";

/** Tramo "vencido": más de 30 días desde la fecha del documento (las ventas no tienen fecha de vencimiento). */
export const OVERDUE_RECEIVABLES_BUCKET: AgingBucket = "30+";
/** Tramo "por vencer": de 8 a 30 días. */
export const DUE_SOON_RECEIVABLES_BUCKET: AgingBucket = "8-30";

/** El reporte de cuentas por cobrar, ya filtrado por el tramo vencido. */
export const OVERDUE_RECEIVABLES_HREF = `/reports?report=receivables-aging&bucket=${encodeURIComponent(
  OVERDUE_RECEIVABLES_BUCKET,
)}`;

/**
 * Misma regla que `GET /api/reports/receivables-aging` (`assertMoneyReportAccess`):
 * `reports.view` y (`payments.manage` o `sales.create`). No se copia la lista.
 */
export function canViewOverdueReceivables(
  permissions: readonly Permission[],
  role: UserRole | undefined,
) {
  if (!role) {
    return false;
  }

  try {
    assertMoneyReportAccess("receivables-aging", { permissions, role });

    return true;
  } catch {
    return false;
  }
}

/** "1 documento con más de 30 días" / "3 documentos con más de 30 días". */
export function describeOverdueReceivables(count: number) {
  if (count <= 0) {
    return "Sin documentos con más de 30 días";
  }

  return count === 1 ? "1 documento con más de 30 días" : `${count} documentos con más de 30 días`;
}

function findBucket(buckets: readonly AgingBucketSummary[] | undefined, bucket: AgingBucket) {
  return buckets?.find((row) => row.bucket === bucket);
}

/**
 * Tarjeta del dashboard (REP-09b): cuentas por cobrar con más de 30 días y,
 * debajo, las de 8 a 30 ("por vencer"), con enlace al reporte filtrado. Solo
 * lee el resumen del reporte (una petición con la página mínima).
 *
 * Es un aviso: sin permiso para el reporte ni lo pide ni se monta; cargando,
 * con error o sin documentos en esos dos tramos no pinta nada, así nunca deja
 * hueco en la columna.
 */
export function DashboardOverdueReceivablesCard({ className }: { className?: string }) {
  const { isLoading, permissions, role } = usePermission();
  const canView = !isLoading && canViewOverdueReceivables(permissions, role);
  const report = useReceivablesAgingReport({ limit: MIN_PAGE_LIMIT }, { enabled: canView });
  const overdue = findBucket(report.data?.summary.buckets, OVERDUE_RECEIVABLES_BUCKET);
  const dueSoon = findBucket(report.data?.summary.buckets, DUE_SOON_RECEIVABLES_BUCKET);
  const overdueCount = overdue?.documentsCount ?? 0;
  const dueSoonCount = dueSoon?.documentsCount ?? 0;

  if (!canView || report.error || (overdueCount <= 0 && dueSoonCount <= 0)) {
    return null;
  }

  return (
    <Link
      className={cn(
        "flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:border-amber-900 dark:bg-amber-950 dark:hover:bg-amber-900",
        className,
      )}
      href={OVERDUE_RECEIVABLES_HREF}
    >
      <Clock aria-hidden className="size-5 shrink-0 text-amber-600 dark:text-amber-400" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">
          Cuentas por cobrar vencidas
        </span>
        <span className="block text-sm text-foreground">
          {describeOverdueReceivables(overdueCount)}
          {overdue && overdueCount > 0 ? (
            <>
              {" · "}
              <span className="font-semibold tabular-nums">{formatRefUsd(overdue.pendingRef)}</span>
            </>
          ) : null}
        </span>
        {overdue && overdueCount > 0 ? (
          <span className="block text-xs tabular-nums text-on-surface-variant">
            {formatVesBs(overdue.pendingVes)}
          </span>
        ) : null}
        {dueSoon && dueSoonCount > 0 ? (
          <span className="mt-1 block text-xs tabular-nums text-on-surface-variant">
            Por vencer: {dueSoonCount} · {formatRefUsd(dueSoon.pendingRef)}
          </span>
        ) : null}
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-amber-700 dark:text-amber-300">
        Ver
        <ArrowRight aria-hidden className="size-4" />
      </span>
    </Link>
  );
}
