"use client";

import { AlertTriangle } from "lucide-react";

import {
  getInvoiceTaxAssessment,
  getTaxInclusion,
  type InvoiceReviewAction,
  type InvoiceReviewState,
} from "../reviewModel";
import { formatInvoiceMoney } from "./invoiceReviewView";
import { ChoiceButton } from "./InvoiceReviewRateNotice";

export type InvoiceReviewTaxNoticeProps = {
  state: InvoiceReviewState;
  onAction: (action: InvoiceReviewAction) => void;
};

/**
 * SCN-UI-Q1 (ALTO-1): la suma de las líneas ya da el total de referencia (leído o, sin
 * él, subtotal + IVA leídos) y no la hipótesis "precios sin IVA" (`assessInvoiceTax`,
 * D27). Se avisa y se elige explícitamente; viene marcada la opción que cuadra y se
 * puede cambiar. Se queda visible mientras haya una elección hecha. Con IVA 0,00 (o
 * subtotal = total) nunca se preselecciona: si la suma ya da el total, se pregunta si es
 * exenta o trae el IVA incluido (`exemptOrIncluded`), sin marcar ninguna opción.
 */
export function InvoiceReviewTaxNotice({ onAction, state }: InvoiceReviewTaxNoticeProps) {
  const inclusion = getTaxInclusion(state);
  const { reference, plainSource, exemptOrIncluded } = getInvoiceTaxAssessment(state);
  const chosen = state.pricesIncludeTax !== undefined;
  if (!inclusion.suggested && !exemptOrIncluded && !chosen) {
    return null;
  }
  // Sin sugerencia ni elección (exenta o IVA incluido sin desglosar) no se marca ninguna.
  const marked = inclusion.suggested || chosen;
  const { subtotal, tax } = state.extraction;
  const money = (value: number | undefined) => (value !== undefined ? ` (${formatInvoiceMoney(state, value)})` : "");
  const referenceText =
    reference?.source === "subtotalPlusTax"
      ? `el subtotal más el IVA leídos${money(reference.amount)}`
      : `el total leído${money(reference?.amount)}`;
  let reason = `no lo desglosa y la suma de las líneas ya da ${referenceText}`;
  if (plainSource === "subtotal") {
    reason = `la suma de las líneas da ${referenceText}, no el subtotal${money(subtotal)}`;
  } else if (plainSource === "totalMinusTax") {
    reason = `la suma de las líneas da ${referenceText}, no el total menos el IVA leído${money(tax)}`;
  }

  return (
    <div
      className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
      data-testid="invoice-review-tax-notice"
      role="status"
    >
      <p className="flex items-start gap-2">
        <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>
          {exemptOrIncluded && !inclusion.suggested
            ? `La factura no trae IVA y la suma de las líneas ya da ${referenceText}: si es exenta, marca las líneas como exentas; si los precios incluyen IVA, indícalo.`
            : `Los precios de esta factura parecen incluir IVA: ${reason}.`}
        </span>
      </p>
      <div aria-label="IVA en los precios de la factura" className="flex flex-wrap gap-2" role="radiogroup">
        <ChoiceButton
          checked={marked && inclusion.included}
          onClick={() => onAction({ type: "setPricesIncludeTax", included: true })}
        >
          Los precios incluyen IVA (cargar sin IVA)
        </ChoiceButton>
        <ChoiceButton
          checked={marked && !inclusion.included}
          onClick={() => onAction({ type: "setPricesIncludeTax", included: false })}
        >
          Los precios no incluyen IVA
        </ChoiceButton>
      </div>
    </div>
  );
}
