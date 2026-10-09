"use client";

import { useId, useState } from "react";

import { useVault } from "@/modules/vault/hooks/useVault";
import { getVaultBalancesState } from "@/modules/vault/vault-home/utils/vaultBalancesState";
import {
  buildVaultBucketConfirmEffects,
  formatVaultAmount,
  vaultBucketLabels,
} from "@/modules/vault/vault-home/utils/vaultEffect";
import {
  ConfirmActionModal,
  type ConfirmActionEffect,
  type ConfirmActionStatus,
} from "@/shared/components/ConfirmActionModal";
import { Textarea } from "@/shared/components/Textarea";
import { paymentMethodLabels } from "@/shared/payments/paymentMethods";
import { formatRefUsd } from "@/shared/utils/currency";

import { useCancelPayrollPayment } from "../../hooks/usePayroll";
import type { PayrollItem, PayrollPeriodStatus } from "../../types";
import { computePayrollVaultEffect } from "../utils/payrollVaultEffect";

type PayrollCancelPaymentModalProps = {
  /** El recibo pagado que se va a anular. `null` cierra el modal. */
  item: PayrollItem | null;
  onOpenChange: (open: boolean) => void;
  /** Estado de la quincena: si estaba pagada, anular un recibo la devuelve a aprobada. */
  periodStatus?: PayrollPeriodStatus;
};

/**
 * Anular un pago de nómina devuelve el dinero a la cubeta del baúl de la que
 * salió (`cancel_payroll_payment`), así que confirma con el saldo actual →
 * resultante. La API exige un motivo (`PT400` si llega vacío); queda en las
 * notas de la quincena.
 */
export function PayrollCancelPaymentModal({
  item,
  onOpenChange,
  periodStatus,
}: PayrollCancelPaymentModalProps) {
  const cancelPayment = useCancelPayrollPayment();
  const vault = useVault();
  const notesId = useId();
  const [notes, setNotes] = useState("");
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedNotes = notes.trim();
  const notesError = hasSubmitted && trimmedNotes.length === 0 ? "Explica por qué se anula" : null;
  // Un recibo pagado en cero no tiene movimiento de baúl: no hay dinero que devolver.
  const movedMoney = Boolean(item?.vaultMovementId);
  const balances = getVaultBalancesState(vault);
  const vaultEffect =
    item && movedMoney && balances.vault
      ? computePayrollVaultEffect({
          amounts: [item.paidAmount ?? 0],
          direction: "in",
          method: item.paidMethod,
          vault: balances.vault,
        })
      : null;
  // Sin los saldos no hay efecto que enseñar; un recibo en cero no los necesita.
  const status: ConfirmActionStatus = movedMoney ? balances.status : "ready";
  const receiptEffect: ConfirmActionEffect = {
    after: "Pendiente",
    before: "Pagado",
    label: "Recibo",
    tone: "warning",
  };
  const periodEffects: ConfirmActionEffect[] =
    periodStatus === "pagado"
      ? [{ after: "Aprobada", before: "Pagada", label: "Quincena", tone: "warning" }]
      : [];
  const effects: ConfirmActionEffect[] = vaultEffect
    ? [receiptEffect, ...periodEffects, ...buildVaultBucketConfirmEffects(vaultEffect.buckets)]
    : [
        receiptEffect,
        ...periodEffects,
        { label: "No vuelve dinero al baúl: el recibo se pagó sin moverlo" },
      ];

  function close() {
    setNotes("");
    setHasSubmitted(false);
    setError(null);
    onOpenChange(false);
  }

  async function handleConfirm() {
    setHasSubmitted(true);
    setError(null);

    if (!item || trimmedNotes.length === 0) {
      return;
    }

    try {
      await cancelPayment.mutateAsync({ itemId: item.id, notes: trimmedNotes });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo anular el pago.");
      return;
    }

    close();
  }

  return (
    <ConfirmActionModal
      confirmLabel="Anular pago"
      description={
        vaultEffect
          ? `El dinero vuelve a ${vaultBucketLabels[vaultEffect.bucketKey]} del baúl y el recibo queda pendiente de nuevo.`
          : "El recibo queda pendiente de nuevo."
      }
      effects={effects}
      error={error}
      isPending={cancelPayment.isPending}
      onConfirm={handleConfirm}
      onOpenChange={(open) => {
        if (!open) {
          close();
        }
      }}
      onRetry={() => void vault.refetch()}
      open={item !== null}
      status={status}
      statusHint={status === "loading" ? undefined : "No se ha anulado nada."}
      statusMessage={movedMoney ? balances.statusMessage : null}
      title="Anular pago de nómina"
      variant="danger"
    >
      {item ? (
        <div className="space-y-3">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
            <dt>Cajero</dt>
            <dd className="break-words font-medium text-foreground">{item.fullName}</dd>
            <dt>Comisión</dt>
            <dd className="font-medium tabular-nums text-foreground">
              {formatRefUsd(item.totalRef)}
            </dd>
            {vaultEffect ? (
              <>
                <dt>Pagado</dt>
                <dd className="font-medium tabular-nums text-foreground">
                  {formatVaultAmount(vaultEffect.currency, vaultEffect.amount)}
                  {item.paidMethod ? ` · ${paymentMethodLabels[item.paidMethod]}` : ""}
                </dd>
              </>
            ) : null}
          </dl>
          {status === "ready" ? (
            <Textarea
              error={notesError ?? undefined}
              id={notesId}
              label="Motivo"
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Por ejemplo: se pagó con el método equivocado"
              rows={3}
              value={notes}
            />
          ) : null}
        </div>
      ) : null}
    </ConfirmActionModal>
  );
}
