import { formatTaxRatePct } from "@/shared/components/TaxRateChips";
import type { TaxRate } from "@/shared/hooks/useTaxRates";
import { roundMoney } from "@/shared/utils/currency";

import type {
  PurchaseDraftItem,
  PurchaseLineChange,
  PurchaseLineLockState,
  PurchaseLineReviewState,
  PurchaseLineSnapshot,
  PurchaseLineTax,
  PurchaseTaxBreakdownRow,
  PurchaseTaxState,
  PurchaseWebLine,
} from "../types";
import { getDraftLineTotals, syncLineCostFields } from "./normalizePurchaseLine";
import { EMPTY_PURCHASE_REVIEW_STATE, getPurchaseLineItemChanges } from "./purchaseLineReview";

const PCT_TOLERANCE = 0.0001;
const EXEMPT_PCT = 0;

export const PURCHASE_LINE_TAX_REQUIRED_MESSAGE = "Elige una alícuota";

export const EMPTY_PURCHASE_TAX_STATE: PurchaseTaxState = { choices: {}, exempt: false };

/** Alícuota ACTIVA con ese porcentaje; si hay varias gana la por defecto de la tienda. */
export function findActiveTaxRateByPct(rates: TaxRate[], pct: number) {
  const matches = rates.filter(
    (rate) => rate.isActive && Math.abs(rate.pct - pct) < PCT_TOLERANCE,
  );

  return matches.find((rate) => rate.isDefault) ?? matches[0] ?? null;
}

/** Alícuota a la que lleva "Compra exenta": la activa del 0 %. */
export function findExemptTaxRate(rates: TaxRate[]) {
  return findActiveTaxRateByPct(rates, EXEMPT_PCT);
}

/**
 * Alícuota efectiva de una línea.
 *
 * Por defecto es la de la categoría del producto (el catálogo de la compra solo
 * trae su porcentaje: se resuelve a la alícuota activa con ese %) o, con
 * "Compra exenta", la del 0 %. Una elección a mano gana siempre, también con el
 * toggle activo. Sin alícuota activa que aplicar, `code` queda en `null`.
 */
export function resolvePurchaseLineTax(input: {
  /** Porcentaje de IVA de la categoría del producto. */
  categoryPct: number;
  /** `code` elegido a mano en la línea, si lo hay. */
  choiceCode?: string;
  exempt: boolean;
  rates: TaxRate[];
}): PurchaseLineTax {
  const categoryRate = findActiveTaxRateByPct(input.rates, input.categoryPct);
  const defaultRate = input.exempt ? findExemptTaxRate(input.rates) : categoryRate;
  const chosenRate = input.choiceCode
    ? (input.rates.find((rate) => rate.isActive && rate.code === input.choiceCode) ?? null)
    : null;
  const rate = chosenRate ?? defaultRate;

  return {
    categoryCode: categoryRate?.code ?? null,
    code: rate?.code ?? null,
    label: rate?.label ?? null,
    manual: Boolean(chosenRate && chosenRate.code !== defaultRate?.code),
    rate: rate?.pct ?? (input.exempt ? EXEMPT_PCT : Math.max(0, input.categoryPct)),
  };
}

/**
 * Líneas de la compra con su alícuota resuelta y `item.taxRate` igualado a ella,
 * para que los helpers de core (`getDraftLineTotals`, `sumDraftPurchaseTotals`,
 * `draftToPurchaseItemInput`) calculen con el porcentaje que ve el usuario.
 *
 * Con `review`, cada línea asentada trae además qué cambió respecto a su foto
 * (`changes`, `edited`); una línea recién nacida nunca está editada. Con
 * `locks`, si está bloqueada.
 */
export function buildPurchaseWebLines(input: {
  getCategoryPct: (productId: string) => number;
  items: PurchaseDraftItem[];
  rateVes: number;
  rates: TaxRate[];
  /** Líneas bloqueadas; sin él ninguna lo está. */
  locks?: PurchaseLineLockState;
  /** Historial de edición; sin él ninguna línea sale como editada. */
  review?: PurchaseLineReviewState;
  taxState: PurchaseTaxState;
}): PurchaseWebLine[] {
  const review = input.review ?? EMPTY_PURCHASE_REVIEW_STATE;

  return input.items.map((item) => {
    const taxInput = {
      categoryPct: input.getCategoryPct(item.productId),
      exempt: input.taxState.exempt,
      rates: input.rates,
    };
    const tax = resolvePurchaseLineTax({
      ...taxInput,
      choiceCode: input.taxState.choices[item.id],
    });
    const synced = syncLineCostFields({ ...item, taxRate: tax.rate }, input.rateVes);
    const changesSince = (snapshot: PurchaseLineSnapshot | undefined): PurchaseLineChange[] => {
      if (!snapshot) {
        return [];
      }

      // La alícuota de la foto se resuelve con el catálogo y el toggle de AHORA:
      // así "Compra exenta" o un catálogo que carga tarde no cuentan como edición.
      const snapshotTax = resolvePurchaseLineTax({
        ...taxInput,
        choiceCode: snapshot.taxChoice ?? undefined,
      });
      const changes = getPurchaseLineItemChanges(
        syncLineCostFields(snapshot.item, input.rateVes),
        synced,
      );

      return snapshotTax.code === tax.code
        ? changes
        : [
            ...changes,
            {
              field: "tax",
              from: formatLineTaxLabel(snapshotTax),
              label: "IVA",
              to: formatLineTaxLabel(tax),
            },
          ];
    };
    const changes = changesSince(review.baselines[item.id]);
    const reviewed = review.reviewed[item.id];

    return {
      changes,
      edited: changes.length > 0,
      editedMark: reviewed ? changesSince(reviewed).length > 0 : changes.length > 0,
      item: synced,
      locked: input.locks?.locked[item.id] === true,
      tax,
    };
  });
}

/** El usuario eligió una alícuota en los chips de la línea. No toca el toggle. */
export function chooseLineTax(
  state: PurchaseTaxState,
  itemId: string,
  code: string,
): PurchaseTaxState {
  return { ...state, choices: { ...state.choices, [itemId]: code } };
}

/** La línea se quitó de la compra: su elección no debe sobrevivirle. */
export function dropLineTax(state: PurchaseTaxState, itemId: string): PurchaseTaxState {
  if (!(itemId in state.choices)) {
    return state;
  }

  const choices = { ...state.choices };
  delete choices[itemId];

  return { ...state, choices };
}

/**
 * Activa o desactiva "Compra exenta". En ambos sentidos se descartan las
 * elecciones a mano: al activar todas las líneas pasan a Exento y al desactivar
 * cada una vuelve a la alícuota de su categoría.
 */
export function setPurchaseExempt(exempt: boolean): PurchaseTaxState {
  return { choices: {}, exempt };
}

/**
 * Líneas cuya alícuota elegida a mano se pierde al activar "Compra exenta"
 * (las que ya estaban en la exenta no cambian y no se cuentan).
 */
export function countManualLinesLostToExempt(lines: PurchaseWebLine[], rates: TaxRate[]) {
  const exemptCode = findExemptTaxRate(rates)?.code ?? null;

  return lines.filter((line) => line.tax.manual && line.tax.code !== exemptCode).length;
}

export function buildExemptOverrideNotice(count: number) {
  return count === 1
    ? "1 línea tenía una alícuota elegida a mano; ahora es exenta"
    : `${count} líneas tenían una alícuota elegida a mano; ahora son exentas`;
}

/** "General 16 %"; sin alícuota válida, "Sin alícuota 12 %". */
export function formatLineTaxLabel(tax: Pick<PurchaseLineTax, "label" | "rate">) {
  return `${tax.label ?? "Sin alícuota"} ${formatTaxRatePct(tax.rate)}`;
}

/**
 * Desglose del resumen: base e IVA por cada alícuota presente, de menor a mayor
 * porcentaje. Agrupa los montos por línea de `getDraftLineTotals`, los mismos que
 * suma `sumDraftPurchaseTotals`: el desglose cuadra al céntimo con los totales.
 */
export function buildPurchaseTaxBreakdown(
  lines: PurchaseWebLine[],
  rateVes: number,
): PurchaseTaxBreakdownRow[] {
  const rows = new Map<string, PurchaseTaxBreakdownRow>();

  for (const { item, tax } of lines) {
    const key = tax.code ?? `sin-alicuota-${tax.rate}`;
    const totals = getDraftLineTotals(item, rateVes);
    const row = rows.get(key) ?? {
      baseRef: 0,
      baseVes: 0,
      key,
      label: formatLineTaxLabel(tax),
      rate: tax.rate,
      taxRef: 0,
      taxVes: 0,
    };

    rows.set(key, {
      ...row,
      baseRef: roundMoney(row.baseRef + totals.subtotalRef),
      baseVes: roundMoney(row.baseVes + totals.subtotalVes),
      taxRef: roundMoney(row.taxRef + totals.taxRef),
      taxVes: roundMoney(row.taxVes + totals.taxVes),
    });
  }

  return [...rows.values()].sort((left, right) => left.rate - right.rate);
}
