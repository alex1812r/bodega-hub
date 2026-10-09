"use client";

import type { ReactNode } from "react";

import {
  ConfirmActionModal,
  type ConfirmActionEffect,
  type ConfirmActionStatus,
} from "@/shared/components/ConfirmActionModal";
import type { ImpactMoneyEffect, ImpactMoneyTarget } from "@/shared/impact/types";
import type { PaymentStatus, PurchaseStatus, SaleStatus } from "@/shared/mocks/erp-data";
import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";

import { usePaymentImpact } from "../hooks/usePaymentImpact";
import {
  formatPaymentHeading,
  paymentMethodLabels,
} from "../payment-details/utils/paymentDetailLabels";
import type { PaymentImpact } from "../services/paymentImpact";

type PaymentCancelConfirmModalProps = {
  /** Mensaje del rechazo de la anulación; se muestra tal cual dentro del modal. */
  error?: string | null;
  isConfirming?: boolean;
  onConfirm: () => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  paymentId: string;
};

const MODAL_TITLE = "Confirmar anulación";

const paymentStatusLabels: Record<PaymentStatus, string> = {
  activo: "Activo",
  anulado: "Anulado",
};

const documentStatusLabels: Record<PurchaseStatus | SaleStatus, string> = {
  borrador: "Borrador",
  cancelada: "Cancelada",
  cancelado: "Cancelado",
  devuelta: "Devuelta",
  devuelto: "Devuelto",
  pagada: "Pagada",
  pedido: "Pedido",
  pendiente_pago: "Pendiente de pago",
  recibido: "Recibido",
};

const vaultLabels: Record<Exclude<ImpactMoneyTarget, "caja">, string> = {
  baul_cuenta: "baúl (cuenta)",
  baul_efectivo_ves: "baúl (efectivo Bs)",
  baul_ref: "baúl (efectivo REF)",
};

function formatMoney(value: number, currency: "USD" | "VES") {
  return currency === "USD" ? formatRefUsd(value) : formatVesBs(value);
}

function formatSignedMoney(value: number, currency: "USD" | "VES") {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";

  return `${sign}${formatMoney(Math.abs(value), currency)}`;
}

/** Destino con nombre, sentido y monto de un asiento que la anulación revierte. */
function moneyEffectLabel(effect: ImpactMoneyEffect) {
  const amount = formatSignedMoney(effect.delta, effect.currency);

  if (effect.target === "caja") {
    const register = `la caja «${effect.targetName ?? "sin nombre"}»`;

    if (!effect.physical) {
      const entry = effect.delta < 0 ? "cobro" : "vuelto";

      return `Se quita del turno de ${register} el ${entry} por cuenta (no mueve la gaveta): ${amount}`;
    }

    return effect.delta < 0
      ? `Sale de ${register}: ${amount}`
      : `Vuelve a ${register} (vuelto entregado): ${amount}`;
  }

  const vault = vaultLabels[effect.target];

  if (effect.delta === 0) {
    return `El ${vault} no cambia`;
  }

  return effect.delta > 0 ? `Vuelve al ${vault}: ${amount}` : `Sale del ${vault}: ${amount}`;
}

function moneyEffects(impact: PaymentImpact): ConfirmActionEffect[] {
  return impact.effects.flatMap((effect) => {
    const hasBalance = effect.balanceBefore !== null && effect.balanceAfter !== null;
    const rows: ConfirmActionEffect[] = [
      {
        after: hasBalance ? formatMoney(effect.balanceAfter ?? 0, effect.currency) : undefined,
        before: hasBalance ? formatMoney(effect.balanceBefore ?? 0, effect.currency) : undefined,
        label: moneyEffectLabel(effect),
        tone: effect.delta < 0 ? "warning" : "neutral",
      },
    ];

    if (effect.note) {
      // En el baúl la única aclaración es el saldo recortado a 0, que deja de cuadrar.
      rows.push({ label: effect.note, tone: effect.target === "caja" ? "warning" : "danger" });
    }

    return rows;
  });
}

function documentEffects({ document }: PaymentImpact): ConfirmActionEffect[] {
  const subject = document.kind === "sale" ? "la venta" : "la compra";
  const rows: ConfirmActionEffect[] = [
    {
      after: formatVesBs(document.paidVesAfter),
      before: formatVesBs(document.paidVes),
      label: `Pagado de ${subject} ${document.number}`,
    },
  ];

  if (document.paidRef !== null && document.paidRefAfter !== null) {
    rows.push({
      after: formatRefUsd(document.paidRefAfter),
      before: formatRefUsd(document.paidRef),
      label: "Pagado (REF)",
    });
  }

  rows.push({
    after: formatVesBs(document.pendingVesAfter),
    before: formatVesBs(document.pendingVes),
    label: "Saldo pendiente",
    tone: document.pendingVesAfter > document.pendingVes ? "warning" : "neutral",
  });

  if (document.pendingRef !== null && document.pendingRefAfter !== null) {
    rows.push({
      after: formatRefUsd(document.pendingRefAfter),
      before: formatRefUsd(document.pendingRef),
      label: "Saldo pendiente (REF)",
      tone: document.pendingRefAfter > document.pendingRef ? "warning" : "neutral",
    });
  }

  rows.push(
    document.statusAfter === document.status
      ? {
          after: documentStatusLabels[document.status],
          label: `Estado de ${subject} (no cambia)`,
        }
      : {
          after: documentStatusLabels[document.statusAfter],
          before: documentStatusLabels[document.status],
          label: `Estado de ${subject}`,
          tone: "warning",
        },
  );

  return rows;
}

function buildEffects(impact: PaymentImpact): ConfirmActionEffect[] {
  return [
    {
      after: paymentStatusLabels[impact.payment.statusAfter],
      before: paymentStatusLabels[impact.payment.status],
      label: "Estado del pago",
      tone: "danger",
    },
    ...moneyEffects(impact),
    // Lo que no se pudo anticipar se dice tal cual, sin cifras inventadas.
    ...(impact.inexact ? [{ label: impact.inexact.reason, tone: "warning" as const }] : []),
    ...documentEffects(impact),
  ];
}

function SummaryRow({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-3 gap-y-0.5">
      <dt className="text-on-surface-variant">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium text-foreground">{children}</dd>
    </div>
  );
}

/** Documento, contacto, método y monto del pago que se va a anular. */
function PaymentImpactSummary({ impact }: { impact: PaymentImpact }) {
  const { document, payment } = impact;
  const isRefPayment = payment.currency === "USD";

  return (
    <dl className="space-y-1.5 text-sm">
      <SummaryRow label={payment.direction === "entrada" ? "Cobro" : "Pago a proveedor"}>
        {formatPaymentHeading(payment.id)}
      </SummaryRow>
      <SummaryRow label={document.kind === "sale" ? "Venta" : "Compra"}>
        {document.number}
      </SummaryRow>
      <SummaryRow label={document.kind === "sale" ? "Cliente" : "Proveedor"}>
        {document.contactName ?? "Sin contacto"}
      </SummaryRow>
      <SummaryRow label="Método">{paymentMethodLabels[payment.method]}</SummaryRow>
      <SummaryRow label="Monto">
        {isRefPayment ? formatRefUsd(payment.amount) : formatVesBs(payment.amount)}{" "}
        <span className="font-normal text-on-surface-variant">
          ({isRefPayment ? formatVesBs(payment.amountVes) : formatRefUsd(payment.amountRef)})
        </span>
      </SummaryRow>
      {payment.changeVes > 0 ? (
        <>
          <SummaryRow label="Vuelto entregado">
            {formatVesBs(payment.changeVes)}
            {payment.changeMethod ? ` · ${paymentMethodLabels[payment.changeMethod]}` : ""}
          </SummaryRow>
          <SummaryRow label="Aportó al documento">{formatVesBs(payment.netVes)}</SummaryRow>
        </>
      ) : null}
    </dl>
  );
}

/**
 * Confirmación de «Anular pago» con su efecto exacto (CNF-06). Pide el impact
 * (`GET /api/payments/{id}/impact`) mientras está abierto y solo ofrece el botón
 * de anular cuando el efecto está calculado y la RPC lo permitiría: cargando,
 * con error o con la anulación bloqueada es el mismo diálogo, de solo lectura.
 */
export function PaymentCancelConfirmModal({
  error,
  isConfirming = false,
  onConfirm,
  onOpenChange,
  open,
  paymentId,
}: PaymentCancelConfirmModalProps) {
  const impact = usePaymentImpact({ enabled: open, paymentId });
  // Cada apertura recalcula: mientras llega, las cifras de la anterior no valen.
  const data = impact.isFetching ? undefined : impact.data;

  let status: ConfirmActionStatus = "loading";
  let statusMessage = "Calculando el efecto de anular el pago...";
  let statusHint: string | undefined = "Hasta conocerlo no se puede anular.";
  let description = `Pago ${formatPaymentHeading(paymentId)}`;

  if (data) {
    status = data.allowed ? "ready" : "blocked";
    statusMessage = data.reason ?? "";
    statusHint = undefined;
    description = data.allowed
      ? `${data.description} Esta acción no se puede deshacer.`
      : data.description;
  } else if (impact.isError && !impact.isFetching) {
    status = "error";
    statusMessage = impact.error?.message ?? "";
    statusHint = "No pudimos calcular el efecto de anular este pago, así que no se puede confirmar.";
  }

  return (
    <ConfirmActionModal
      confirmLabel="Anular pago"
      description={description}
      effects={data ? buildEffects(data) : undefined}
      error={error}
      isPending={isConfirming}
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
      onRetry={() => void impact.refetch()}
      open={open}
      status={status}
      statusHint={statusHint}
      statusMessage={statusMessage}
      title={status === "blocked" ? "No se puede anular el pago" : MODAL_TITLE}
      variant="danger"
    >
      {data ? <PaymentImpactSummary impact={data} /> : null}
    </ConfirmActionModal>
  );
}
