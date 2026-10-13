"use client";

import { useMemo } from "react";

import { type ActionMenuItem } from "@/shared/components/ActionsMenu";
import { Button } from "@/shared/components/Button";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { EmptyState } from "@/shared/components/EmptyState";
import type { StockMovementType } from "@/shared/mocks/erp-data";
import { cn } from "@/shared/utils/cn";
import { formatDateTimeShort } from "@/shared/utils/date";

import type { InventoryMovementDocumentKind } from "../../hooks/useInventory";
import { getMovementTypeLabel } from "../utils/movementTypeLabels";
import { InventoryMovementDocumentCell } from "./InventoryMovementDocumentCell";
import { InventoryMovementQuantityCell } from "./InventoryMovementQuantityCell";
import { InventoryMovementTypeBadge } from "./InventoryMovementTypeBadge";

export type InventoryMovementRow = {
  conversionId?: string;
  createdAt: string;
  documentKind?: InventoryMovementDocumentKind | null;
  documentNumber?: string | null;
  id: string;
  product: string;
  productSku?: string;
  purchaseId?: string;
  quantity: number;
  reason?: string;
  saleId?: string;
  stockAfter: number;
  type: StockMovementType;
};

/**
 * Por qué no hay filas: sin movimientos, ninguno coincide con los filtros o el
 * rango de fechas está invertido y no se consultó.
 */
export type InventoryMovementsEmptyKind = "filtered" | "invalid-range" | "none";

/**
 * Ocho columnas de datos + acciones en el ancho que deja el menú lateral a
 * 1280 px (≈ 940 px): padding lateral de 8 px en vez de 16 (la primera conserva
 * 16 a la izquierda), como la tabla de `/inventory`. "SKU" y "Motivo" solo desde
 * xl: con el menú lateral fijo a 1024 px quedan ≈ 690 px y "Acciones" debe verse
 * sin desplazar la tabla (el SKU pasa bajo el nombre; el motivo está en "Ver detalle").
 */
const compactColumnClass = "px-2";
/** Columna secundaria de la tabla: oculta hasta xl (en tarjetas se muestra siempre). */
const wideOnlyColumnClass = "hidden px-2 xl:table-cell";

function buildColumns(returnTo?: string): DataTableColumn<InventoryMovementRow>[] {
  return [
    {
      cellClassName: "whitespace-nowrap text-on-surface-variant",
      className: "px-2 pl-4",
      header: "Fecha",
      key: "createdAt",
      render: (row) => formatDateTimeShort(row.createdAt),
    },
    {
      className: compactColumnClass,
      header: "Producto",
      key: "product",
      render: (row) => (
        <div className="flex flex-col">
          <span className="font-medium text-foreground">{row.product}</span>
          {row.productSku ? (
            <span className="text-xs text-on-surface-variant xl:hidden">
              SKU: {row.productSku}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      cellClassName: "font-mono text-sm text-on-surface-variant",
      className: wideOnlyColumnClass,
      header: "SKU",
      hideInCard: true,
      key: "productSku",
      render: (row) => row.productSku ?? "—",
    },
    {
      className: compactColumnClass,
      header: "Tipo",
      key: "type",
      render: (row) => <InventoryMovementTypeBadge type={row.type} />,
    },
    {
      align: "right",
      className: compactColumnClass,
      header: "Cant.",
      key: "quantity",
      render: (row) => <InventoryMovementQuantityCell quantity={row.quantity} />,
    },
    {
      align: "right",
      cellClassName: "font-semibold tabular-nums",
      className: compactColumnClass,
      header: "Saldo",
      key: "stockAfter",
      render: (row) => (
        <span
          className={cn(row.stockAfter < 0 && "text-error")}
          data-negative={row.stockAfter < 0 ? "true" : undefined}
          title={row.stockAfter < 0 ? "Saldo negativo" : undefined}
        >
          {row.stockAfter}
        </span>
      ),
    },
    {
      cellClassName: "min-w-[8rem] max-w-[12rem]",
      className: compactColumnClass,
      header: "Documento",
      key: "document",
      render: (row) => <InventoryMovementDocumentCell movement={row} returnTo={returnTo} />,
    },
    {
      cellClassName: "max-w-[14rem] truncate text-on-surface-variant",
      className: wideOnlyColumnClass,
      header: "Motivo",
      key: "reason",
      render: (row) => row.reason ?? "Sin motivo",
    },
  ];
}

type InventoryMovementsTableProps = {
  actions?: (row: InventoryMovementRow) => ActionMenuItem[];
  emptyKind?: InventoryMovementsEmptyKind;
  error?: Error | string | null;
  isFetching?: boolean;
  isLoading?: boolean;
  /** Con `emptyKind="filtered"` se ofrece "Limpiar filtros". */
  onClearFilters?: () => void;
  onRetry?: () => void;
  /** URL de la lista: el detalle de la venta o compra vuelve a ella. */
  returnTo?: string;
  rows: InventoryMovementRow[];
};

function MovementsEmptyState({
  kind,
  onClearFilters,
}: {
  kind: InventoryMovementsEmptyKind;
  onClearFilters?: () => void;
}) {
  if (kind === "invalid-range") {
    return (
      <EmptyState
        description="La fecha inicial no puede ser posterior a la final. Corrige el rango para ver los movimientos."
        title="Revisa el rango de fechas"
      />
    );
  }

  if (kind === "filtered") {
    return (
      <EmptyState
        action={
          onClearFilters ? (
            <Button onClick={onClearFilters} size="sm" variant="outline">
              Limpiar filtros
            </Button>
          ) : undefined
        }
        description="Prueba con otro rango de fechas o quita algún filtro."
        title="Ningún movimiento coincide con los filtros"
      />
    );
  }

  return (
    <EmptyState
      description="Las ventas, compras, conversiones de empaque y ajustes de stock aparecerán aquí."
      title="Aún no hay movimientos de inventario"
    />
  );
}

export function InventoryMovementsTable({
  actions,
  emptyKind = "none",
  error,
  isFetching,
  isLoading,
  onClearFilters,
  onRetry,
  returnTo,
  rows,
}: InventoryMovementsTableProps) {
  const columns = useMemo(() => buildColumns(returnTo), [returnTo]);

  return (
    <DataTable
      actions={actions}
      cardSubtitle={(row) => getMovementTypeLabel(row.type)}
      cardTitle={(row) => row.product}
      columns={columns}
      data={rows}
      embedded
      emptyState={<MovementsEmptyState kind={emptyKind} onClearFilters={onClearFilters} />}
      error={error}
      getRowId={(row) => row.id}
      isFetching={isFetching}
      isLoading={isLoading}
      onRetry={onRetry}
      variant="stitch-purchases"
    />
  );
}
