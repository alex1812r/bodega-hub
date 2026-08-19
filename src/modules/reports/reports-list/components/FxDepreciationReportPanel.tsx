"use client";

import { getPaginatedItems } from "@/lib/api/pagination";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { EmptyState } from "@/shared/components/EmptyState";
import { ResponsivePagination, usePaginationState } from "@/shared/components/Pagination";
import { formatRef, formatVes } from "@/shared/utils/currency";
import { formatDate } from "@/shared/utils/date";

import {
  type FxDepreciationReportRow,
  type FxDepreciationReportSummary,
  type ReportDateRangeFilters,
  type ReportRequestScope,
  useFxDepreciationReport,
} from "../../hooks/useReports";

const methodLabels: Record<string, string> = {
  efectivo_usd: "Efectivo USD",
  efectivo_ves: "Efectivo VES",
  pago_movil: "Pago movil",
  punto_venta: "Punto de venta",
  transferencia: "Transferencia",
};

const saleColumns: DataTableColumn<FxDepreciationReportRow>[] = [
  { header: "Factura", key: "invoiceNumber", render: (row) => row.invoiceNumber },
  { header: "Fecha", key: "saleDate", render: (row) => formatDate(row.saleDate) },
  {
    align: "right",
    header: "Tasa venta",
    key: "rateAtSale",
    render: (row) => formatVes(row.rateAtSale),
  },
  {
    align: "right",
    header: "VES cobrado",
    key: "vesCollected",
    render: (row) => formatVes(row.vesCollected),
  },
  {
    align: "right",
    header: "USD (REF)",
    key: "usdRef",
    render: (row) => formatRef(row.usdRef),
  },
  {
    align: "right",
    header: "REF al cobrar",
    key: "vesRefAtCollection",
    render: (row) => formatRef(row.vesRefAtCollection),
  },
  {
    align: "right",
    header: "REF hoy",
    key: "vesRefToday",
    render: (row) => formatRef(row.vesRefToday),
  },
  {
    align: "right",
    header: "Perdida REF",
    key: "lossRef",
    render: (row) => formatRef(row.lossRef),
  },
];

function SummaryCard({
  hint,
  label,
  value,
}: {
  hint?: string;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-outline-variant bg-surface-container-lowest px-4 py-3">
      <p className="text-xs text-on-surface-variant">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{value}</p>
      {hint ? <p className="mt-1 text-xs text-on-surface-variant">{hint}</p> : null}
    </div>
  );
}

function FxSummary({ summary }: { summary: FxDepreciationReportSummary }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          hint={
            summary.valuationRateAt
              ? `Registrada ${formatDate(summary.valuationRateAt)}`
              : "Sin tasa registrada"
          }
          label="Tasa de valorizacion"
          value={formatVes(summary.valuationRateVes)}
        />
        <SummaryCard
          hint={`Al cobrar: ${formatRef(summary.vesRefAtCollection)}`}
          label="VES a la mano (hoy en REF)"
          value={formatRef(summary.vesRefToday)}
        />
        <SummaryCard
          hint={`Expuesto: ${formatVes(summary.vesExposed)}`}
          label="Perdida por tasa (VES)"
          value={`${formatRef(summary.vesLossRef)} (${summary.depreciationPctOnVes}%)`}
        />
        <SummaryCard
          hint={`USD retenido: ${formatRef(summary.usdHeldRef)} · al cobrar ${formatRef(summary.capitalRefAtCollection)}`}
          label="Capital total hoy (REF)"
          value={formatRef(summary.capitalRefToday)}
        />
      </div>

      {summary.byMethod.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-outline-variant">
          <table className="min-w-full text-sm">
            <thead className="bg-surface-container text-left text-on-surface-variant">
              <tr>
                <th className="px-3 py-2 font-medium">Metodo</th>
                <th className="px-3 py-2 text-right font-medium">Pagos</th>
                <th className="px-3 py-2 text-right font-medium">Monto VES</th>
                <th className="px-3 py-2 text-right font-medium">REF al cobrar</th>
                <th className="px-3 py-2 text-right font-medium">REF hoy</th>
                <th className="px-3 py-2 text-right font-medium">Perdida</th>
              </tr>
            </thead>
            <tbody>
              {summary.byMethod.map((row) => (
                <tr className="border-t border-outline-variant" key={row.method}>
                  <td className="px-3 py-2">
                    {methodLabels[row.method] ?? row.method}
                    {!row.exposedToFx ? (
                      <span className="ml-2 text-xs text-on-surface-variant">(sin FX)</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.paymentCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatVes(row.amountVes)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatRef(row.amountRef)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatRef(row.refToday)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatRef(row.lossRef)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

type FxDepreciationReportPanelProps = {
  dateFilters: ReportDateRangeFilters;
  scope?: ReportRequestScope;
};

export function FxDepreciationReportPanel({
  dateFilters,
  scope,
}: FxDepreciationReportPanelProps) {
  const pagination = usePaginationState([
    scope?.pathPrefix,
    scope?.storeScope,
    scope?.storeIds,
    dateFilters.from,
    dateFilters.to,
  ]);
  const query = useFxDepreciationReport(
    {
      ...dateFilters,
      limit: pagination.limit,
      skip: pagination.skip,
    },
    scope,
  );
  const items = getPaginatedItems(query.data);
  const summary = query.data?.summary;

  return (
    <section className="space-y-4 rounded-lg border border-outline-variant bg-surface-container-lowest p-5 shadow-sm">
      <div>
        <h3 className="text-base font-semibold text-foreground">Depreciacion FX</h3>
        <p className="mt-1 text-sm text-on-surface-variant">
          Valoriza lo cobrado en VES a la tasa vigente al generar el reporte. El efectivo USD se
          mantiene en REF.
        </p>
      </div>

      {query.isLoading ? (
        <p className="text-sm text-on-surface-variant">Cargando depreciacion FX...</p>
      ) : null}

      {query.error ? (
        <p className="text-sm text-error">No se pudo generar el reporte de depreciacion FX.</p>
      ) : null}

      {summary ? <FxSummary summary={summary} /> : null}

      {!query.isLoading && !query.error && items.length === 0 ? (
        <EmptyState
          description="No hay pagos de venta en el rango seleccionado."
          title="Sin movimientos"
        />
      ) : null}

      {items.length > 0 ? (
        <>
          <DataTable columns={saleColumns} data={items} getRowId={(row) => row.saleId} />
          <div className="flex justify-center border-t border-outline-variant px-4 py-3">
            <ResponsivePagination
              className="w-full justify-end"
              isDisabled={query.isFetching}
              limit={pagination.limit}
              onLimitChange={pagination.setLimit}
              onSkipChange={pagination.setSkip}
              showSummary={false}
              skip={pagination.skip}
              total={query.data?.total ?? 0}
              variant="stitch"
            />
          </div>
        </>
      ) : null}
    </section>
  );
}
