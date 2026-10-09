import type { ReactNode } from "react";

import { PurchasesStatusBadge } from "@/modules/purchases/purchases-list/components/PurchasesStatusBadge";
import {
  PrimaryStateAction,
  type PrimaryStateActionConfig,
  type PrimaryStateFigureTone,
} from "@/shared/components/PrimaryStateAction";
import type { PurchaseStatus } from "@/shared/mocks/erp-data";
import { formatRefUsd, formatVesBs, roundMoney } from "@/shared/utils/currency";

import { formatPurchaseHeading } from "../utils/purchaseDetailLabels";
import { getPurchaseClosedNotice } from "./purchasePrimaryAction";

type PurchaseDetailStateHeaderProps = {
  /** Menú "…" de la compra; va junto al título, con sus acciones de siempre. */
  actionsMenu: ReactNode;
  /** Tasa de hoy: con ella el saldo se muestra también en bolívares. */
  currentRateVes?: number;
  paidRef: number;
  paidVes: number;
  pendingRef: number;
  /** Acción que toca según el estado; sin ella la cabecera no pinta botón. */
  primaryAction?: PrimaryStateActionConfig;
  purchaseNumber: string;
  refRateVes: number;
  status: PurchaseStatus;
  totalRef: number;
  totalVes: number;
};

type PaymentState = { label: string; tone: PrimaryStateFigureTone };

function getPaymentState(paidRef: number, pendingRef: number): PaymentState {
  if (pendingRef < 0.01) {
    return { label: "Pagado", tone: "success" };
  }

  return paidRef > 0.01
    ? { label: "Pago parcial", tone: "warning" }
    : { label: "Pendiente", tone: "default" };
}

/** Cabecera del detalle: número y estado de la compra, sus cifras y la acción que toca. */
export function PurchaseDetailStateHeader({
  actionsMenu,
  currentRateVes = 0,
  paidRef,
  paidVes,
  pendingRef,
  primaryAction,
  purchaseNumber,
  refRateVes,
  status,
  totalRef,
  totalVes,
}: PurchaseDetailStateHeaderProps) {
  const paymentState = getPaymentState(paidRef, pendingRef);
  const pendingVesToday = currentRateVes > 0 ? roundMoney(pendingRef * currentRateVes) : null;
  const closedNotice = getPurchaseClosedNotice(status);

  return (
    <PrimaryStateAction
      ariaLabel="Resumen de la compra"
      figures={[
        {
          hint: (
            <>
              {formatVesBs(totalVes)}
              <span className="block">Tasa: 1 REF = {refRateVes.toFixed(2)} VES</span>
            </>
          ),
          label: "Total",
          value: formatRefUsd(totalRef),
        },
        { hint: formatVesBs(paidVes), label: "Pagado", value: formatRefUsd(paidRef) },
        {
          hint: pendingVesToday != null ? `≈ hoy en Bs: ${formatVesBs(pendingVesToday)}` : undefined,
          label: "Saldo",
          // Una compra cancelada o devuelta ya no se paga: su saldo no es una alerta.
          tone: pendingRef > 0.01 && closedNotice === null ? "danger" : "default",
          value: formatRefUsd(pendingRef),
        },
        { label: "Estado de pago", tone: paymentState.tone, value: paymentState.label },
      ]}
      notice={closedNotice ? { text: closedNotice, tone: "warning" } : undefined}
      primaryAction={primaryAction}
      status={
        <>
          <h2 className="min-w-0 text-xl font-semibold text-slate-950 [overflow-wrap:anywhere] md:text-2xl dark:text-slate-100">
            {formatPurchaseHeading(purchaseNumber)}
          </h2>
          <PurchasesStatusBadge status={status} />
          <div className="ml-auto">{actionsMenu}</div>
        </>
      }
    />
  );
}
