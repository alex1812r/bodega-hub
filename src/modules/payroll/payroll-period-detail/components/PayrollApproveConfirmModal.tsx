"use client";

import { useState } from "react";

import {
  ConfirmActionModal,
  type ConfirmActionEffect,
} from "@/shared/components/ConfirmActionModal";
import { formatRefUsd } from "@/shared/utils/currency";

import { useApprovePayrollPeriod } from "../../hooks/usePayroll";
import type { PayrollItem, PayrollPeriod } from "../../types";
import { formatPeriodLabel } from "../../utils/quincena";

type PayrollApproveConfirmModalProps = {
  /** Recibos del borrador que la pantalla ya tiene cargados. */
  items: PayrollItem[];
  onOpenChange: (open: boolean) => void;
  open: boolean;
  /** La quincena en borrador que se va a aprobar. */
  period: PayrollPeriod;
};

function countLabel(count: number, singular: string, plural: string) {
  return `${String(count)} ${count === 1 ? singular : plural}`;
}

/**
 * Lo que `approve_payroll_period` hace de verdad, con las cifras del borrador:
 * recalcula dentro de la transacción, registra cada venta comisionada a nombre
 * de esta quincena (ninguna otra podrá comisionarla) y pasa la quincena a
 * aprobada. No mueve el baúl. No existe la operación inversa.
 */
export function buildPayrollApproveEffects(
  period: Pick<PayrollPeriod, "totalRef">,
  items: Pick<PayrollItem, "salesCount">[],
): ConfirmActionEffect[] {
  const salesCount = items.reduce((total, item) => total + item.salesCount, 0);

  return [
    { after: "Aprobada", before: "Borrador", label: "Quincena", tone: "warning" },
    {
      after: `${countLabel(items.length, "recibo", "recibos")} · ${formatRefUsd(period.totalRef)}`,
      label: "Quedan por pagar",
      tone: "warning",
    },
    {
      after: countLabel(salesCount, "venta", "ventas"),
      label: "Quedan comisionadas en esta quincena; ninguna otra podrá comisionarlas",
      tone: "warning",
    },
    {
      label: "Ya no se podrá recalcular ni devolver a borrador",
      tone: "danger",
    },
    {
      label:
        "Las cifras se recalculan al aprobar: pueden variar si se anularon o cobraron ventas desde el último cálculo",
      tone: "warning",
    },
    { label: "El baúl no se mueve: el dinero sale al pagar cada recibo" },
  ];
}

/**
 * Aprobar una quincena es irreversible (no hay RPC que la devuelva a borrador),
 * así que confirma en tono de peligro con el periodo, los cajeros y el total.
 * El rechazo del servidor se lee tal cual dentro del diálogo.
 */
export function PayrollApproveConfirmModal({
  items,
  onOpenChange,
  open,
  period,
}: PayrollApproveConfirmModalProps) {
  const approve = useApprovePayrollPeriod(period.id);
  const [error, setError] = useState<string | null>(null);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setError(null);
    }

    onOpenChange(nextOpen);
  }

  async function handleConfirm() {
    setError(null);

    try {
      await approve.mutateAsync();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo aprobar la quincena.");
      return;
    }

    handleOpenChange(false);
  }

  return (
    <ConfirmActionModal
      confirmLabel="Aprobar quincena"
      description="Aprobar fija las comisiones que se pagarán por esta quincena. No se puede deshacer."
      effects={buildPayrollApproveEffects(period, items)}
      error={error}
      isPending={approve.isPending}
      onConfirm={handleConfirm}
      onOpenChange={handleOpenChange}
      open={open}
      title="Aprobar quincena"
      variant="danger"
    >
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        <dt>Periodo</dt>
        <dd className="break-words font-medium text-foreground">
          {formatPeriodLabel(period.periodKey)} · del {period.fromDate} al {period.toDate}
        </dd>
        <dt>Cajeros</dt>
        <dd className="font-medium tabular-nums text-foreground">{items.length}</dd>
        <dt>Ventas comisionables</dt>
        <dd className="font-medium tabular-nums text-foreground">
          {formatRefUsd(period.salesRef)}
        </dd>
        <dt>Comisión</dt>
        <dd className="font-medium tabular-nums text-foreground">
          {formatRefUsd(period.commissionRef)}
        </dd>
        <dt>Reversos</dt>
        <dd className="font-medium tabular-nums text-foreground">
          {formatRefUsd(period.reversalRef)}
        </dd>
        <dt>Total de nómina</dt>
        <dd className="font-medium tabular-nums text-foreground">
          {formatRefUsd(period.totalRef)}
        </dd>
      </dl>
    </ConfirmActionModal>
  );
}
