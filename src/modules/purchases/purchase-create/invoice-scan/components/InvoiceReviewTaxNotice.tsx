"use client";

import { AlertTriangle } from "lucide-react";

import { getTaxInclusion, hasTaxBreakdown, type InvoiceReviewAction, type InvoiceReviewState } from "../reviewModel";
import { formatInvoiceMoney } from "./invoiceReviewView";
import { ChoiceButton } from "./InvoiceReviewRateNotice";

export type InvoiceReviewTaxNoticeProps = {
  state: InvoiceReviewState;
  onAction: (action: InvoiceReviewAction) => void;
};

/**
 * SCN-UI-Q1 (ALTO-1): la suma de las líneas ya da el total leído, sin desglose de IVA
 * o (M3, D25-a) con desglose pero sin ser el subtotal. Se avisa y se elige
 * explícitamente; viene marcada la opción que cuadra con el total leído y se puede
 * cambiar. Se queda visible mientras haya una elección hecha.
 */
export function InvoiceReviewTaxNotice({ onAction, state }: InvoiceReviewTaxNoticeProps) {
  const inclusion = getTaxInclusion(state);
  if (!inclusion.suggested && state.pricesIncludeTax === undefined) {
    return null;
  }
  const { subtotal, total: read } = state.extraction;
  const readText = read !== undefined ? ` (${formatInvoiceMoney(state, read)})` : "";
  const reason = hasTaxBreakdown(state)
    ? `la suma de las líneas da el total leído${readText}, no el subtotal${
        subtotal !== undefined ? ` (${formatInvoiceMoney(state, subtotal)})` : ""
      }`
    : `no lo desglosa y la suma de las líneas ya da el total leído${readText}`;

  return (
    <div
      className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
      data-testid="invoice-review-tax-notice"
      role="status"
    >
      <p className="flex items-start gap-2">
        <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>Los precios de esta factura parecen incluir IVA: {reason}.</span>
      </p>
      <div aria-label="IVA en los precios de la factura" className="flex flex-wrap gap-2" role="radiogroup">
        <ChoiceButton
          checked={inclusion.included}
          onClick={() => onAction({ type: "setPricesIncludeTax", included: true })}
        >
          Los precios incluyen IVA (cargar sin IVA)
        </ChoiceButton>
        <ChoiceButton
          checked={!inclusion.included}
          onClick={() => onAction({ type: "setPricesIncludeTax", included: false })}
        >
          Los precios no incluyen IVA
        </ChoiceButton>
      </div>
    </div>
  );
}
