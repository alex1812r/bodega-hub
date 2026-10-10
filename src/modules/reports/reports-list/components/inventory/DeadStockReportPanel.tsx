"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";

import { getPaginatedItems } from "@/lib/api/pagination";
import { useAllCategories } from "@/modules/products/hooks/useProducts";
import type { DataTableColumn } from "@/shared/components/DataTable";
import { EmptyState } from "@/shared/components/EmptyState";
import { NumberInput } from "@/shared/components/NumberInput";
import { RankingBarChart, type RankingBarItem } from "@/shared/components/RankingBarChart";
import {
  stitchListFilterFieldClassName,
  stitchListFilterLabelClassName,
} from "@/shared/styles/form-controls";
import { cn } from "@/shared/utils/cn";
import { formatRef } from "@/shared/utils/currency";
import { withReturnTo } from "@/shared/utils/returnTo";

import { type DeadStockFilters, useDeadStockReport } from "../../../hooks/useInventoryReports";
import { DEAD_STOCK_MAX_DAYS, type DeadStockRow } from "../../../services/inventoryReports";
import type { ReportDefinition } from "../../config/reportCatalog";
import { useReportPanelReady } from "../../reportPanelReady";
import { getReportQueryError } from "../../reportQueryState";
import { ReportQueryError } from "../money/ReportStates";
import { ReportChartCard } from "../ReportChartCard";
import { ReportChipGroup, type ReportChipOption } from "../ReportChipGroup";
import {
  formatResultsRange,
  ReportTable,
  type ReportPagination,
  useResetPagePastTheEnd,
} from "../ReportTable";
import { ReportTableSection } from "../ReportTableSection";
import {
  DEAD_STOCK_NOTE,
  formatCaracasDay,
  formatDaysCount,
  formatPct,
  formatUnits,
  NO_VALUE,
} from "./inventoryReportText";
import { ReportStatTiles } from "./ReportStatTiles";

const DAYS_OPTIONS: readonly ReportChipOption<number>[] = [30, 60, 90, 180].map((days) => ({
  label: `${days} días`,
  value: days,
}));

const linkClassName =
  "font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function productLabel(row: DeadStockRow) {
  return row.product.name || row.product.sku || NO_VALUE;
}

function buildColumns(listHref: string | undefined): DataTableColumn<DeadStockRow>[] {
  return [
    {
      header: "Producto",
      key: "product",
      render: (row) => (
        <Link className={linkClassName} href={withReturnTo(row.product.href, listHref)}>
          {productLabel(row)}
        </Link>
      ),
    },
    { header: "SKU", key: "sku", render: (row) => row.product.sku || NO_VALUE },
    { header: "Categoría", key: "category", render: (row) => row.category.name || NO_VALUE },
    { align: "right", header: "Stock", key: "stock", render: (row) => formatUnits(row.stock) },
    { align: "right", header: "Costo", key: "costRef", render: (row) => formatRef(row.costRef) },
    {
      align: "right",
      header: "Valor",
      key: "stockValueRef",
      render: (row) => <span className="font-semibold">{formatRef(row.stockValueRef)}</span>,
    },
    {
      header: "Última venta",
      key: "lastSaleAt",
      render: (row) => (row.lastSaleAt ? formatCaracasDay(row.lastSaleAt) : "Nunca"),
    },
    { align: "right", header: "Días sin vender", key: "daysIdle", render: (row) => row.daysIdle },
    {
      align: "right",
      header: "Días desde el último movimiento",
      key: "daysSinceLastMovement",
      render: (row) => row.daysSinceLastMovement ?? NO_VALUE,
    },
  ];
}

/**
 * Valor libre de días. Solo avisa al salir del campo o con Enter, con un entero
 * de 1 a 3650: cada tecla no es una consulta. Se monta con `key={days}` para
 * que un chip pulsado se refleje en el campo.
 */
function CustomDaysInput({ days, onCommit }: { days: number; onCommit: (days: number) => void }) {
  const [draft, setDraft] = useState<number | null>(days);

  function commit() {
    if (draft === null) {
      setDraft(days);
      return;
    }

    // Con decimales el campo queda inválido con su mensaje: no se pide nada.
    if (!Number.isInteger(draft)) {
      return;
    }

    const next = Math.min(DEAD_STOCK_MAX_DAYS, Math.max(1, draft));

    if (next !== days) {
      onCommit(next);
    }
  }

  return (
    <div className="w-36">
      <NumberInput
        decimals={0}
        label="Otro valor (días)"
        max={DEAD_STOCK_MAX_DAYS}
        min={1}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            commit();
          }
        }}
        onValueChange={setDraft}
        value={draft}
      />
    </div>
  );
}

/**
 * Filtro de categoría: el mismo selector de las listas de Productos e
 * Inventario (todas las categorías activas, por nombre). Si la categoría de la
 * URL no está en la lista (inactiva, o la lista no cargó), sigue seleccionada
 * con el nombre que traen las filas del reporte.
 */
function CategoryFilter({
  categoryId,
  fallbackName,
  onChange,
}: {
  categoryId: string | undefined;
  fallbackName: string | undefined;
  onChange: (categoryId: string | undefined) => void;
}) {
  const selectId = useId();
  const categories = useAllCategories();
  const options = getPaginatedItems(categories.data);
  const isListed = !categoryId || options.some((category) => category.id === categoryId);

  return (
    <div className="w-full min-w-0 sm:w-64">
      <label className={stitchListFilterLabelClassName} htmlFor={selectId}>
        Categoría
      </label>
      <select
        className={cn(stitchListFilterFieldClassName, "w-full min-w-0")}
        id={selectId}
        onChange={(event) => onChange(event.target.value || undefined)}
        value={categoryId ?? ""}
      >
        <option value="">Todas las categorías</option>
        {isListed ? null : <option value={categoryId}>{fallbackName ?? "Categoría seleccionada"}</option>}
        {options.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </select>
    </div>
  );
}

type DeadStockReportPanelProps = {
  /** Categoría filtrada (`categoryId` de la URL). */
  categoryId?: string;
  /** Días sin vender (`days` de la URL; 30 por defecto). */
  days: number;
  /** URL actual de la lista, para el `returnTo` de los enlaces. */
  listHref?: string;
  onFiltersChange: (patch: { categoryId?: string; days?: number }) => void;
  /** Página y tamaño (URL): la tabla se pagina en servidor. */
  pagination: ReportPagination;
  report: Pick<ReportDefinition, "name">;
};

/**
 * Productos sin movimiento: los que tienen stock y llevan N días o más sin
 * venderse, con su capital inmovilizado. El resumen es de todo el conjunto; las
 * barras, de la página visible (el servidor ordena por valor, así que la
 * primera página es el top global).
 */
export function DeadStockReportPanel({
  categoryId,
  days,
  listHref,
  onFiltersChange,
  pagination,
  report,
}: DeadStockReportPanelProps) {
  const filters: DeadStockFilters = {
    categoryId,
    days,
    limit: pagination.limit,
    skip: pagination.skip,
  };
  const query = useDeadStockReport(filters);

  useReportPanelReady(!query.isLoading);

  const queryError = getReportQueryError(query);
  const { data } = query;
  const items = data?.items;
  const total = data?.total ?? 0;
  const hasProducts = total > 0;
  // Vacío confirmado por el servidor; mientras llega una página la tabla sigue montada.
  const isEmpty = data !== undefined && !hasProducts;
  const columns = useMemo(() => buildColumns(listHref), [listHref]);
  const chartItems = useMemo<RankingBarItem[]>(
    () =>
      (items ?? []).map((row) => ({
        id: row.product.id,
        label: productLabel(row),
        value: row.stockValueRef,
      })),
    [items],
  );
  const shown = Math.min(chartItems.length, 10);
  // La primera página ya es el top global (orden por valor en servidor).
  const isFirstPage = (data?.skip ?? pagination.skip) === 0;
  const topLabel =
    shown === 0
      ? null
      : isFirstPage
        ? total > shown
          ? `Top ${shown} de ${total} productos`
          : null
        : `Top ${shown} de esta página`;
  const fallbackCategoryName = items?.find((row) => row.category.id === categoryId)?.category.name;

  useResetPagePastTheEnd(query, pagination);

  return (
    <div className="min-w-0 space-y-4">
      <ReportChartCard
        notice={DEAD_STOCK_NOTE}
        subtitle={[`${formatDaysCount(days)} o más sin vender`, "Valor inmovilizado en REF", topLabel]
          .filter(Boolean)
          .join(" · ")}
        title={report.name}
        total={
          data && hasProducts
            ? { label: "Capital inmovilizado", value: formatRef(data.summary.idleValueRef) }
            : undefined
        }
      >
        <div className="flex min-w-0 flex-wrap items-end gap-x-6 gap-y-3">
          <ReportChipGroup
            label="Días sin vender"
            onChange={(nextDays) => onFiltersChange({ days: nextDays })}
            options={DAYS_OPTIONS}
            value={days}
          />
          <CustomDaysInput
            days={days}
            key={days}
            onCommit={(nextDays) => onFiltersChange({ days: nextDays })}
          />
          <CategoryFilter
            categoryId={categoryId}
            fallbackName={fallbackCategoryName}
            onChange={(nextCategoryId) => onFiltersChange({ categoryId: nextCategoryId })}
          />
        </div>

        {queryError ? (
          <ReportQueryError
            error={queryError}
            onRetry={() => void query.refetch()}
            reportName={report.name}
          />
        ) : isEmpty ? (
          <EmptyState
            description={`No hay productos con stock que lleven ${formatDaysCount(days)} o más sin venderse${
              categoryId ? " en esta categoría" : ""
            }.`}
            title="Ningún producto sin movimiento"
          />
        ) : (
          <>
            {data ? (
              <ReportStatTiles
                label="Resumen de productos sin movimiento"
                stats={[
                  { label: "Productos sin movimiento", value: String(data.summary.productsCount) },
                  { label: "Capital inmovilizado", value: formatRef(data.summary.idleValueRef) },
                  {
                    hint: `de ${formatRef(data.summary.inventoryValueRef)} en inventario`,
                    label: "Del valor del inventario",
                    value: formatPct(data.summary.idleValuePct),
                  },
                ]}
              />
            ) : null}
            <RankingBarChart
              ariaLabel={`${report.name}: valor inmovilizado en REF`}
              items={chartItems}
              loading={query.isLoading}
            />
          </>
        )}
      </ReportChartCard>

      {!queryError && !isEmpty ? (
        <ReportTableSection
          summary={formatResultsRange(data?.skip ?? pagination.skip, pagination.limit, total)}
        >
          <ReportTable
            columns={columns}
            getRowId={(row) => row.product.id}
            limit={pagination.limit}
            onLimitChange={pagination.setLimit}
            onSkipChange={pagination.setSkip}
            query={query}
            report={report}
            skip={pagination.skip}
          />
        </ReportTableSection>
      ) : null}
    </div>
  );
}
