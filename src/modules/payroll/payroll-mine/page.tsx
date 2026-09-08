"use client";

import { useState } from "react";

import { useSettings } from "@/modules/settings/hooks/useSettings";
import { Badge } from "@/shared/components/Badge";
import { Button } from "@/shared/components/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/components/Card";
import { EmptyState } from "@/shared/components/EmptyState";
import { EntityListPage } from "@/shared/components/EntityListPage";
import { formatRefUsd } from "@/shared/utils/currency";
import { formatDateTimeShort } from "@/shared/utils/date";

import { PayrollSalesModal } from "../components/PayrollSalesModal";
import {
  payrollItemStatusLabels,
  payrollItemStatusVariants,
} from "../components/payrollLabels";
import { useMyPayrollCurrent, useMyPayrollItems } from "../hooks/usePayroll";
import { exportPayrollReceiptPdf } from "../payroll-receipt/services/exportPayrollReceiptPdf";
import type { PayrollMineItem } from "../types";
import { formatPeriodLabel } from "../utils/quincena";

function ReceiptFigure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="tabular-nums text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

/**
 * Pantalla del cajero. Nunca muestra cifras del negocio: ni ganancia bruta, ni
 * semaforo, ni el desglose del dueño.
 */
export function PayrollMinePage() {
  const receiptsQuery = useMyPayrollItems();
  const currentQuery = useMyPayrollCurrent();
  const appSettings = useSettings();
  const [salesReceipt, setSalesReceipt] = useState<PayrollMineItem | null>(null);

  const receipts = receiptsQuery.data ?? [];
  const estimate = currentQuery.data?.estimate ?? null;

  return (
    <EntityListPage
      description="Tu comision por quincena, con el detalle de las ventas que la generaron."
      layout="sections"
      title="Mis recibos"
    >
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Quincena en curso</CardTitle>
            <Badge variant="info">Estimacion</Badge>
          </div>
          <CardDescription>
            {currentQuery.data
              ? formatPeriodLabel(currentQuery.data.currentPeriodKey)
              : "Cargando..."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-3xl font-semibold tabular-nums text-foreground">
            {currentQuery.isLoading ? "—" : formatRefUsd(estimate?.totalRef ?? 0)}
          </p>
          <p className="text-xs text-on-surface-variant">
            Estimacion viva: sube con cada venta tuya que se cobra y baja si alguna se cancela.
            No es un pago aprobado.
          </p>
          {estimate ? (
            <p className="text-sm text-on-surface-variant">
              {estimate.salesCount} ventas · {formatRefUsd(estimate.salesRef)} al{" "}
              {estimate.commissionPct.toFixed(2)} %
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recibos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {receiptsQuery.isLoading ? (
            <p className="text-sm text-on-surface-variant">Cargando recibos...</p>
          ) : receiptsQuery.error ? (
            <p className="text-sm text-destructive">No pudimos cargar tus recibos.</p>
          ) : receipts.length === 0 ? (
            <EmptyState
              className="py-8"
              description="Cuando se apruebe una quincena veras aqui tu recibo."
              title="Sin recibos todavia"
            />
          ) : (
            receipts.map((receipt) => (
              <div
                className="rounded-lg border border-outline-variant p-4"
                key={receipt.item.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">
                      {formatPeriodLabel(receipt.period.periodKey)}
                    </p>
                    <p className="text-xs text-on-surface-variant">
                      {receipt.period.periodKey} · del {receipt.period.fromDate} al{" "}
                      {receipt.period.toDate}
                    </p>
                  </div>
                  <Badge variant={payrollItemStatusVariants[receipt.item.status]}>
                    {payrollItemStatusLabels[receipt.item.status]}
                  </Badge>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  <ReceiptFigure label="Ventas" value={String(receipt.item.salesCount)} />
                  <ReceiptFigure
                    label="Ventas REF"
                    value={formatRefUsd(receipt.item.salesRef)}
                  />
                  <ReceiptFigure
                    label="Comision"
                    value={`${receipt.item.commissionPct.toFixed(2)} %`}
                  />
                  <ReceiptFigure
                    label="Reversos"
                    value={
                      receipt.item.reversalRef === 0
                        ? "—"
                        : formatRefUsd(receipt.item.reversalRef)
                    }
                  />
                  <ReceiptFigure label="Total" value={formatRefUsd(receipt.item.totalRef)} />
                </div>

                {receipt.item.paidAt ? (
                  <p className="mt-3 text-xs text-on-surface-variant">
                    Pagado el {formatDateTimeShort(receipt.item.paidAt)}
                    {receipt.item.paidReference
                      ? ` · referencia ${receipt.item.paidReference}`
                      : ""}
                  </p>
                ) : null}

                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <Button
                    onClick={() => setSalesReceipt(receipt)}
                    size="sm"
                    variant="outline"
                  >
                    Ver mis ventas
                  </Button>
                  <Button
                    onClick={() =>
                      exportPayrollReceiptPdf({
                        item: receipt.item,
                        period: receipt.period,
                        sales: receipt.sales,
                        storeName: appSettings.data?.businessName ?? "BodegaHub",
                      })
                    }
                    size="sm"
                  >
                    Descargar recibo PDF
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <PayrollSalesModal
        cashierName={salesReceipt?.item.fullName ?? ""}
        onOpenChange={(open) => {
          if (!open) {
            setSalesReceipt(null);
          }
        }}
        open={salesReceipt !== null}
        sales={salesReceipt?.sales ?? []}
      />
    </EntityListPage>
  );
}
