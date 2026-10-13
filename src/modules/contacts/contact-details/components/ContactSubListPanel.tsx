"use client";

import { Lock } from "lucide-react";
import type { ReactNode } from "react";

import { DEFAULT_PAGE_LIMIT, getPaginatedItems } from "@/lib/api/pagination";
import { ClientApiError } from "@/shared/api/apiFetch";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { EmptyState } from "@/shared/components/EmptyState";
import { ResponsivePagination } from "@/shared/components/Pagination";
import { cn } from "@/shared/utils/cn";

import type { ContactSubList } from "../hooks/useContactSubLists";

/** El servidor respondió 403: el rol no puede ver esa sublista. */
export function isForbiddenError(error: unknown) {
  return error instanceof ClientApiError && error.status === 403;
}

/** Estado 403 de una pestaña: sin "Reintentar", porque reintentar no cambia el permiso. */
export function ContactTabForbidden({ what }: { what: string }) {
  return (
    <EmptyState
      description="Pide a un administrador que revise los permisos de tu rol."
      icon={<Lock aria-hidden className="h-5 w-5" />}
      title={`No tienes permiso para ver ${what} de este contacto`}
    />
  );
}

type ContactSubListPaginationProps = {
  entityLabel: string;
  list: Pick<
    ContactSubList<unknown>,
    "data" | "isFetching" | "isPlaceholderData" | "limit" | "setLimit" | "setSkip" | "skip"
  >;
};

/** Control de página de una sublista; oculto mientras todo quepa en la primera página. */
export function ContactSubListPagination({ entityLabel, list }: ContactSubListPaginationProps) {
  const total = list.data?.total ?? 0;

  // Con el tamaño por defecto como corte: al agrandar la página no desaparece el selector.
  if (total <= DEFAULT_PAGE_LIMIT) {
    return null;
  }

  return (
    <div className="border-t border-outline-variant px-4 py-3 sm:px-6">
      <ResponsivePagination
        entityLabel={entityLabel}
        isDisabled={list.isFetching}
        limit={list.limit}
        onLimitChange={list.setLimit}
        onSkipChange={list.setSkip}
        // Con la página anterior aún a la vista, el control marca la página pedida.
        skip={list.isPlaceholderData ? list.skip : (list.data?.skip ?? list.skip)}
        total={total}
        variant="stitch"
      />
    </div>
  );
}

type ContactSubListPanelProps<TRow> = {
  columns: DataTableColumn<TRow>[];
  emptyDescription: string;
  emptyTitle: string;
  /** Plural en minúsculas para la paginación: "ventas", "pagos"… */
  entityLabel: string;
  /** Con artículo, para el aviso de 403: "las ventas", "los pagos"… */
  forbiddenWhat: string;
  getRowId: (row: TRow) => string;
  icon?: ReactNode;
  list: ContactSubList<TRow>;
};

/**
 * Tabla de una sublista del contacto paginada en servidor, con sus estados
 * cargando, vacío, error (con reintento) y 403.
 */
export function ContactSubListPanel<TRow>({
  columns,
  emptyDescription,
  emptyTitle,
  entityLabel,
  forbiddenWhat,
  getRowId,
  icon,
  list,
}: ContactSubListPanelProps<TRow>) {
  if (isForbiddenError(list.error)) {
    return <ContactTabForbidden what={forbiddenWhat} />;
  }

  return (
    <>
      {/* Mientras llega la página pedida se ven las filas de la anterior: atenuadas y ocupadas. */}
      <div
        aria-busy={list.isPlaceholderData || undefined}
        className={cn("transition-opacity", list.isPlaceholderData && "opacity-60")}
      >
        <DataTable
          columns={columns}
          data={getPaginatedItems(list.data)}
          embedded
          emptyState={<EmptyState description={emptyDescription} icon={icon} title={emptyTitle} />}
          error={list.error}
          getRowId={getRowId}
          isFetching={list.isFetching}
          isLoading={list.isLoading}
          loadingRows={3}
          onRetry={() => void list.refetch()}
          variant="stitch-purchases"
        />
      </div>
      <ContactSubListPagination entityLabel={entityLabel} list={list} />
    </>
  );
}
