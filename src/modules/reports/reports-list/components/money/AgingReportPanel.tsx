"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { useContact } from "@/modules/contacts/hooks/useContacts";
import type { DataTableColumn } from "@/shared/components/DataTable";
import { EmptyState } from "@/shared/components/EmptyState";
import {
  EntityAutocomplete,
  type EntityAutocompleteValue,
} from "@/shared/components/EntityAutocomplete";
import { RankingBarChart, type RankingBarItem } from "@/shared/components/RankingBarChart";
import type { ContactType } from "@/shared/mocks/erp-data";
import { cn } from "@/shared/utils/cn";
import { formatRef, formatVesBs } from "@/shared/utils/currency";
import { formatDate } from "@/shared/utils/date";
import { withReturnTo } from "@/shared/utils/returnTo";

import {
  type AgingReportFilters,
  usePayablesAgingReport,
  useReceivablesAgingReport,
} from "../../../hooks/useMoneyReports";
import type {
  AgingBucket,
  AgingBucketSummary,
  AgingDocumentRow,
} from "../../../services/moneyReports";
import type { ReportDefinition } from "../../config/reportCatalog";
import { getReportQueryError } from "../../reportQueryState";
import { ReportChartCard } from "../ReportChartCard";
import {
  formatResultsRange,
  ReportTable,
  type ReportPagination,
  useResetPagePastTheEnd,
} from "../ReportTable";
import { ReportTableSection } from "../ReportTableSection";
import { AGING_BUCKET_LABELS, formatDocumentsCount } from "./moneyReportText";
import { ReportQueryError } from "./ReportStates";

/** Decisión del gerente: la antigüedad no usa fecha de vencimiento. */
const AGING_NOTE = "La antigüedad se cuenta desde la fecha del documento.";

type AgingReportKind = "payables" | "receivables";

const linkClassName =
  "font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const KIND_TEXT: Record<
  AgingReportKind,
  {
    contactHeader: string;
    contactPlaceholder: string;
    contactTypes: ContactType[];
    documentHeader: string;
    emptyDescription: string;
    emptyTitle: string;
    paidHeader: string;
  }
> = {
  payables: {
    contactHeader: "Proveedor",
    contactPlaceholder: "Todos los proveedores",
    contactTypes: ["proveedor", "ambos"],
    documentHeader: "Compra",
    emptyDescription: "No hay compras con saldo por pagar.",
    emptyTitle: "No debes nada",
    paidHeader: "Pagado",
  },
  receivables: {
    contactHeader: "Cliente",
    contactPlaceholder: "Todos los clientes",
    contactTypes: ["cliente", "ambos"],
    documentHeader: "Venta",
    emptyDescription: "No hay ventas con saldo por cobrar.",
    emptyTitle: "Nadie te debe",
    paidHeader: "Cobrado",
  },
};

function buildColumns(kind: AgingReportKind, listHref: string | undefined): DataTableColumn<AgingDocumentRow>[] {
  const text = KIND_TEXT[kind];

  return [
    {
      header: text.documentHeader,
      key: "document",
      render: (row) => (
        <Link className={linkClassName} href={withReturnTo(row.document.href, listHref)}>
          {row.document.number}
        </Link>
      ),
    },
    {
      header: text.contactHeader,
      key: "contact",
      render: (row) =>
        row.contact ? (
          <Link className={linkClassName} href={withReturnTo(`/contacts/${row.contact.id}`, listHref)}>
            {row.contact.name}
          </Link>
        ) : (
          "—"
        ),
    },
    { header: "Fecha", key: "date", render: (row) => formatDate(row.date) },
    { align: "right", header: "Días", key: "days", render: (row) => row.days },
    { header: "Tramo", key: "bucket", render: (row) => AGING_BUCKET_LABELS[row.bucket] },
    { align: "right", header: "Total", key: "totalRef", render: (row) => formatRef(row.totalRef) },
    { align: "right", header: text.paidHeader, key: "paidRef", render: (row) => formatRef(row.paidRef) },
    {
      align: "right",
      header: "Pendiente REF",
      key: "pendingRef",
      render: (row) => <span className="font-semibold">{formatRef(row.pendingRef)}</span>,
    },
    {
      align: "right",
      header: "Pendiente Bs",
      key: "pendingVes",
      render: (row) => formatVesBs(row.pendingVes),
    },
  ];
}

function ContactFilter({
  contactId,
  kind,
  onChange,
  reportName,
  reportSettled,
}: {
  contactId: string | undefined;
  kind: AgingReportKind;
  onChange: (contactId: string | undefined) => void;
  /** Nombre del contacto según las filas del reporte, si alguna es suya. */
  reportName: string | undefined;
  /** El reporte ya respondió (con datos o con error): se sabe si trae el nombre. */
  reportSettled: boolean;
}) {
  const text = KIND_TEXT[kind];
  const [picked, setPicked] = useState<EntityAutocompleteValue | null>(null);
  const pickedLabel = picked && picked.id === contactId ? picked.label : undefined;
  // El nombre sale, por este orden, de lo elegido en el buscador y de las filas
  // del reporte (un rol sin acceso a Contactos también las ve). Solo si el
  // reporte ya respondió sin ninguna fila del contacto se lee el contacto.
  // Al paginar el reporte se queda un momento sin filas: se conserva el nombre ya visto.
  const [seen, setSeen] = useState<EntityAutocompleteValue | null>(null);

  if (contactId && reportName && (seen?.id !== contactId || seen.label !== reportName)) {
    setSeen({ id: contactId, label: reportName });
  }

  const knownLabel = pickedLabel ?? reportName ?? (seen?.id === contactId ? seen?.label : undefined);
  const needsLookup = knownLabel === undefined && reportSettled;
  const contactQuery = useContact(needsLookup ? contactId : undefined);
  const label =
    knownLabel ??
    contactQuery.data?.name ??
    (contactQuery.error ? "Contacto no disponible" : "Cargando contacto…");

  return (
    <EntityAutocomplete
      entity="contact"
      error={knownLabel === undefined ? contactQuery.error?.message : undefined}
      filters={{ type: text.contactTypes }}
      label={text.contactHeader}
      onChange={(option) => {
        setPicked(option ? { id: option.id, label: option.label } : null);
        onChange(option?.id);
      }}
      placeholder={text.contactPlaceholder}
      value={contactId ? { id: contactId, label } : null}
    />
  );
}

function BucketCards({
  activeBucket,
  buckets,
  onSelect,
}: {
  activeBucket: AgingBucket | undefined;
  buckets: readonly AgingBucketSummary[];
  onSelect: (bucket: AgingBucket | undefined) => void;
}) {
  return (
    <div aria-label="Filtrar por antigüedad" className="grid gap-3 sm:grid-cols-3" role="group">
      {buckets.map((summary) => {
        const isActive = summary.bucket === activeBucket;

        return (
          <button
            aria-pressed={isActive}
            className={cn(
              "min-w-0 cursor-pointer rounded-lg border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive
                ? "border-primary bg-primary/10"
                : "border-outline-variant bg-surface-container-lowest hover:bg-surface-container-low",
            )}
            key={summary.bucket}
            // Pulsar el tramo activo lo quita: vuelven todos los documentos.
            onClick={() => onSelect(isActive ? undefined : summary.bucket)}
            type="button"
          >
            <span className="block text-xs font-medium text-on-surface-variant">
              {AGING_BUCKET_LABELS[summary.bucket]}
            </span>
            <span className="mt-1 block text-lg font-semibold tabular-nums text-foreground">
              {formatRef(summary.pendingRef)}
            </span>
            <span className="block text-xs tabular-nums text-on-surface-variant">
              {formatVesBs(summary.pendingVes)} · {formatDocumentsCount(summary.documentsCount)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

type AgingReportPanelProps = {
  /** Tramo activo (`bucket` de la URL). */
  bucket?: AgingBucket;
  /** Contacto filtrado (`contactId` de la URL). */
  contactId?: string;
  kind: AgingReportKind;
  /** URL actual de la lista, para el `returnTo` de los enlaces. */
  listHref?: string;
  onFiltersChange: (patch: { bucket?: AgingBucket; contactId?: string }) => void;
  /** Página y tamaño (URL): la tabla se pagina en servidor, nunca se trae entera. */
  pagination: ReportPagination;
  report: Pick<ReportDefinition, "name">;
};

/**
 * Cuentas por cobrar / por pagar con antigüedad: tres tramos que filtran, barra
 * por tramo en su orden natural y la tabla de documentos paginada en servidor.
 * Los tramos y el gráfico salen del resumen (todo el conjunto, respeta el
 * contacto y no el tramo), así que no cambian al paginar ni al filtrar por tramo.
 */
export function AgingReportPanel({
  bucket,
  contactId,
  kind,
  listHref,
  onFiltersChange,
  pagination,
  report,
}: AgingReportPanelProps) {
  const text = KIND_TEXT[kind];
  // El panel se monta con `key` por reporte: `kind` no cambia mientras vive.
  const useAgingReport = kind === "receivables" ? useReceivablesAgingReport : usePayablesAgingReport;
  const filters: AgingReportFilters = {
    bucket,
    contactId,
    limit: pagination.limit,
    skip: pagination.skip,
  };
  const query = useAgingReport(filters);
  const queryError = getReportQueryError(query);
  const { data } = query;
  // Cada tramo, contacto o página es otra consulta. Mientras llega se conserva el
  // último resumen: las tarjetas no desaparecen (ni pierde el foco la pulsada).
  // `data` de react-query es estable entre renders, así que esto se asienta solo.
  const [lastSummary, setLastSummary] = useState(data?.summary);

  if (data?.summary && data.summary !== lastSummary) {
    setLastSummary(data.summary);
  }

  const summary = data?.summary ?? lastSummary;
  const hasDebt = Boolean(summary && summary.totals.documentsCount > 0);
  // Con `contactId` todas las filas son de ese contacto: su nombre ya viene en ellas.
  const contactName = contactId
    ? data?.items.find((row) => row.contact?.id === contactId)?.contact?.name
    : undefined;
  const columns = useMemo(() => buildColumns(kind, listHref), [kind, listHref]);
  const chartItems = useMemo<RankingBarItem[]>(
    () =>
      (summary?.buckets ?? []).map((item) => ({
        id: item.bucket,
        label: AGING_BUCKET_LABELS[item.bucket],
        value: item.pendingRef,
      })),
    [summary],
  );

  useResetPagePastTheEnd(query, pagination);

  return (
    <div className="min-w-0 space-y-4">
      <ReportChartCard
        notice={AGING_NOTE}
        subtitle="Pendiente en REF por antigüedad · al día de hoy"
        title={report.name}
        total={summary && hasDebt ? { label: "Pendiente", value: formatRef(summary.totals.pendingRef) } : undefined}
      >
        <div className="max-w-md">
          <ContactFilter
            contactId={contactId}
            kind={kind}
            onChange={(nextContactId) => onFiltersChange({ contactId: nextContactId })}
            reportName={contactName}
            reportSettled={data !== undefined || Boolean(queryError)}
          />
        </div>

        {queryError ? (
          <ReportQueryError
            error={queryError}
            onRetry={() => void query.refetch()}
            reportName={report.name}
          />
        ) : !summary ? (
          <RankingBarChart ariaLabel={report.name} items={[]} loading />
        ) : hasDebt ? (
          <div aria-busy={query.isFetching} className="space-y-4">
            <BucketCards
              activeBucket={bucket}
              buckets={summary.buckets}
              onSelect={(nextBucket) => onFiltersChange({ bucket: nextBucket })}
            />
            <RankingBarChart
              ariaLabel={`${report.name}: pendiente en REF por antigüedad`}
              items={chartItems}
              sort="none"
            />
          </div>
        ) : (
          <EmptyState
            description={contactId ? "Este contacto no tiene saldo pendiente." : text.emptyDescription}
            title={text.emptyTitle}
          />
        )}
      </ReportChartCard>

      {!queryError && hasDebt ? (
        <ReportTableSection
          summary={formatResultsRange(data?.skip ?? pagination.skip, pagination.limit, data?.total ?? 0)}
        >
          <ReportTable
            columns={columns}
            getRowId={(row) => `${row.document.type}-${row.document.id}`}
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
