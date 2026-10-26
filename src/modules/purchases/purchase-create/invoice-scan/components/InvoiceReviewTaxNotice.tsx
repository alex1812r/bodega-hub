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
 * SCN-UI-Q1 (ALTO-1): con IVA incluido las líneas cuadran la cifra leída de referencia
 * (total; subtotal + IVA; solo subtotal frente a la base; solo IVA frente al IVA) y sin
 * IVA no (`assessInvoiceTax`, D27/D29). Se avisa y se elige explícitamente; viene marcada la opción que cuadra y se
 * puede cambiar. Se queda visible mientras haya una elección hecha. Con IVA 0,00 (o
 * subtotal = total) nunca se preselecciona: si la suma ya da el total, se pregunta si es
 * exenta o trae el IVA incluido (`exemptOrIncluded`), sin marcar ninguna opción.
 */
export function InvoiceReviewTaxNotice({ onAction, state }: InvoiceReviewTaxNoticeProps) {
  const inclusion = getTaxInclusion(state);
  const { reference, plainSource, exemptOrIncluded, linesTotal } = getInvoiceTaxAssessment(state);
  const chosen = state.pricesIncludeTax !== undefined;
  if (!inclusion.suggested && !exemptOrIncluded && !chosen) {
    return null;
  }
  // Sin sugerencia ni elección (exenta o IVA incluido sin desglosar) no se marca ninguna.
  const marked = inclusion.suggested || chosen;
  const { subtotal, tax } = state.extraction;
  const money = (value: number | undefined) => (value !== undefined ? ` (${formatInvoiceMoney(state, value)})` : "");
  const referenceNoun =
    reference?.source === "subtotalPlusTax"
      ? `subtotal más el IVA leídos${money(reference.amount)}`
      : `total leído${money(reference?.amount)}`;
  const referenceText = `el ${referenceNoun}`;
  // REP13-05 (B20, caos p5): el cuadre admite tolerancia; si la suma no da la cifra exacta, se dice
  // cuánto da y que se acerca, en vez de afirmar que la da.
  const approximate = reference !== undefined && linesTotal !== undefined && Math.abs(linesTotal - reference.amount) >= 0.005;
  const sumText = approximate
    ? `la suma de las líneas${money(linesTotal)} se acerca al ${referenceNoun}`
    : `la suma de las líneas da ${referenceText}`;
  const notThe = approximate ? "no al" : "no el";
  let reason = approximate ? `no lo desglosa y ${sumText}` : `no lo desglosa y la suma de las líneas ya da ${referenceText}`;
  if (reference?.source === "subtotal") {
    reason = `quitándoselo, las líneas dan el subtotal leído${money(reference.amount)}`;
  } else if (reference?.source === "tax") {
    reason = `el IVA que llevan dentro las líneas da el IVA leído${money(reference.amount)}`;
  } else if (plainSource === "subtotal") {
    reason = `${sumText}, ${notThe} subtotal${money(subtotal)}`;
  } else if (plainSource === "totalMinusTax") {
    reason = `${sumText}, ${notThe} total menos el IVA leído${money(tax)}`;
  }
  // B-p14B-1: elegida y ya sin sugerencia con los costos actuales, el motivo no afirma un cuadre que no existe.
  let message = `Los precios de esta factura parecen incluir IVA: ${reason}.`;
  if (exemptOrIncluded && !inclusion.suggested) {
    message = `La factura no trae IVA y ${approximate ? sumText : `la suma de las líneas ya da ${referenceText}`}: si es exenta, marca las líneas como exentas; si los precios incluyen IVA, indícalo.`;
  } else if (!inclusion.suggested) {
    message = inclusion.included
      ? "Indicaste que los precios incluyen IVA. Con los costos actuales la suma de las líneas ya no lo indica: revisa la elección con la factura."
      : "Indicaste que los precios no incluyen IVA. Con los costos actuales la suma de las líneas ya no indica que lo incluyan: revisa la elección con la factura.";
  }

  return (
    <div
      className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
      data-testid="invoice-review-tax-notice"
      role="status"
    >
      <p className="flex items-start gap-2">
        <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>{message}</span>
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
