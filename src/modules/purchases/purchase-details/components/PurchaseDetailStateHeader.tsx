import type { ReactNode } from "react";

import { PurchasesStatusBadge } from "@/modules/purchases/purchases-list/components/PurchasesStatusBadge";
import {
  PrimaryStateAction,
  type PrimaryStateActionConfig,
  type PrimaryStateFigureTone,
} from "@/shared/components/PrimaryStateAction";
import type { PurchaseStatus } from "@/shared/mocks/erp-data";
import { documentBalance, type DocumentPaymentStatus } from "@/shared/payments/documentBalance";
import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";

import { formatPurchaseHeading } from "../utils/purchaseDetailLabels";
import { getPurchaseClosedNotice } from "./purchasePrimaryAction";

type PurchaseDetailStateHeaderProps = {
  /** Menú "…" de la compra; va junto al título, con sus acciones de siempre. */
  actionsMenu: ReactNode;
  paidRef: number;
  paidVes: number;
  /** Acción que toca según el estado; sin ella la cabecera no pinta botón. */
  primaryAction?: PrimaryStateActionConfig;
  purchaseNumber: string;
  refRateVes: number;
  status: PurchaseStatus;
  totalRef: number;
  totalVes: number;
};

type PaymentState = { label: string; tone: PrimaryStateFigureTone };

const PAYMENT_STATES: Record<DocumentPaymentStatus, PaymentState> = {
  pagada: { label: "Pagado", tone: "success" },
  parcial: { label: "Pago parcial", tone: "warning" },
  pendiente: { label: "Pendiente", tone: "default" },
};

/** Cabecera del detalle: número y estado de la compra, sus cifras y la acción que toca. */
export function PurchaseDetailStateHeader({
  actionsMenu,
  paidRef,
  paidVes,
  primaryAction,
  purchaseNumber,
  refRateVes,
  status,
  totalRef,
  totalVes,
}: PurchaseDetailStateHeaderProps) {
  // Saldo y estado de pago salen de `documentBalance` (criterio del servidor, en Bs):
  // lo mismo que deciden «Pagar», la lista, Saldos del proveedor y Cuentas por pagar.
  const balance = documentBalance({
    paidRef,
    paidVes,
    refRateVes,
    status,
    totalRef,
    totalVes,
    type: "purchase",
  });
  const paymentState = PAYMENT_STATES[balance.paymentStatus];
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
          // La deuda de una compra está fijada en Bs: es lo que `register_payment` deja
          // pagar hoy, con cualquier tasa del día.
          hint: `≈ hoy en Bs: ${formatVesBs(balance.pendingVes)}`,
          label: "Saldo",
          // Una compra cancelada o devuelta ya no se paga: su saldo no es una alerta.
          tone: !balance.settled && closedNotice === null ? "danger" : "default",
          value: formatRefUsd(balance.pendingRef),
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
