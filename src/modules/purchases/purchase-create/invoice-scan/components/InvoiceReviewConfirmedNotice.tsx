"use client";

import { CircleCheck } from "lucide-react";
import Link from "next/link";

import { confirmedPurchaseMessage, type InvoiceReviewState } from "../reviewModel";

export type InvoiceReviewConfirmedNoticeProps = {
  state: InvoiceReviewState;
};

/**
 * REP-01 · La misma foto de una factura ya confirmada: el caché trae la compra
 * ligada. Aviso arriba de la revisión con «Ver» hacia esa compra; "Cargar en la
 * compra" queda bloqueado por el modelo (`getInvoiceReviewBlockers`).
 */
export function InvoiceReviewConfirmedNotice({ state }: InvoiceReviewConfirmedNoticeProps) {
  const purchase = state.confirmedPurchase;
  if (!purchase) {
    return null;
  }

  return (
    <div
      className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
      data-testid="invoice-review-confirmed-notice"
      role="status"
    >
      <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>
        {confirmedPurchaseMessage(purchase)}:{" "}
        <Link
          className="font-medium underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-200"
          href={`/purchases/${encodeURIComponent(purchase.id)}`}
        >
          Ver
        </Link>
        . No se puede cargar otra vez en una compra nueva. Para salir usa «Descartar escaneo»: la compra
        registrada no cambia.
      </span>
    </div>
  );
}
