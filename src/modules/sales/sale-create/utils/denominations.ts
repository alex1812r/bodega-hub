import { roundMoney } from "@/shared/utils/currency";

/** Billetes que realmente circulan en USD: no hay monedas. */
export const USD_BILLS: readonly number[] = [1, 5, 10, 20, 50, 100];

/** Billetes que realmente circulan en Bs. */
export const VES_BILLS: readonly number[] = [10, 20, 50, 100, 200];

export type DenominationCurrency = "USD" | "VES";

/** Conteo de billetes por denominacion: `{ 20: 1, 5: 2 }`. */
export type DenominationCounts = Record<number, number>;

export type DenominationBreakdown = {
  /** Billetes usados, mayor a menor. */
  counts: DenominationCounts;
  /** Monto cubierto por `counts`; nunca supera el solicitado. */
  covered: number;
  /** Lo que quedo sin cubrir (`amount - covered`). */
  remainder: number;
};

export type DenominationTender = {
  counts: DenominationCounts;
  total: number;
};

export type DeliverableChange = {
  counts: DenominationCounts;
  /** Vuelto que si se puede armar con los billetes disponibles. */
  delivered: number;
  /** Sobrante que queda en la gaveta por no ser representable. */
  rounding: number;
};

/** Formato jsonb de `received_denominations` / `change_denominations`. */
export type DenominationsPayload = Partial<
  Record<DenominationCurrency, Record<string, number>>
>;

const EPSILON = 1e-6;
const MAX_QUICK_TENDERS = 3;

export function getBillsForCurrency(currency: DenominationCurrency) {
  return currency === "USD" ? USD_BILLS : VES_BILLS;
}

function toBillCount(value: number | undefined) {
  if (!Number.isFinite(value ?? NaN)) {
    return 0;
  }

  return Math.max(0, Math.trunc(value ?? 0));
}

function sortBillsDesc(bills: readonly number[]) {
  return [...bills].filter((bill) => bill > 0).sort((left, right) => right - left);
}

export function sumDenominations(
  counts: DenominationCounts,
  bills: readonly number[],
) {
  return roundMoney(
    bills.reduce((total, bill) => total + bill * toBillCount(counts[bill]), 0),
  );
}

/** Cuantos billetes hay en total (para mostrar "3 billetes"). */
export function countDenominationBills(
  counts: DenominationCounts,
  bills: readonly number[],
) {
  return bills.reduce((total, bill) => total + toBillCount(counts[bill]), 0);
}

export function adjustDenominationCount(
  counts: DenominationCounts,
  bill: number,
  delta: number,
): DenominationCounts {
  const next = { ...counts };
  const value = toBillCount(next[bill]) + Math.trunc(delta);

  if (value <= 0) {
    delete next[bill];
    return next;
  }

  next[bill] = value;
  return next;
}

/** Desglose mayor a menor; `covered` nunca supera `amount`. */
export function greedyBreakdown(
  amount: number,
  bills: readonly number[],
): DenominationBreakdown {
  const counts: DenominationCounts = {};

  if (!Number.isFinite(amount) || amount <= 0) {
    return { counts, covered: 0, remainder: 0 };
  }

  let rest = roundMoney(amount);

  for (const bill of sortBillsDesc(bills)) {
    const count = Math.floor((rest + EPSILON) / bill);
    if (count > 0) {
      counts[bill] = count;
      rest = roundMoney(rest - count * bill);
    }
  }

  const covered = sumDenominations(counts, bills);

  return {
    counts,
    covered,
    remainder: roundMoney(amount - covered),
  };
}

/**
 * El total mas chico que se puede armar con los billetes y que alcanza `amount`.
 * Para $2,30 con billetes USD devuelve $3 (1 x 3).
 */
export function minimumTenderAtLeast(
  amount: number,
  bills: readonly number[],
): DenominationTender {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { counts: {}, total: 0 };
  }

  const usable = sortBillsDesc(bills);
  if (usable.length === 0) {
    return { counts: {}, total: 0 };
  }

  const smallest = usable[usable.length - 1];
  let target = roundMoney(amount);

  for (let guard = 0; guard < 64; guard += 1) {
    const breakdown = greedyBreakdown(target, bills);

    if (breakdown.remainder <= EPSILON) {
      return { counts: breakdown.counts, total: breakdown.covered };
    }

    target = roundMoney(breakdown.covered + smallest);
  }

  const fallback = greedyBreakdown(target, bills);
  return { counts: fallback.counts, total: fallback.covered };
}

/**
 * Montos rapidos para el restante: el minimo que lo cubre y los 2 escalones
 * siguientes. Para $2,30 → `[3, 5, 10]`.
 */
export function suggestQuickTenders(
  amount: number,
  bills: readonly number[],
): number[] {
  const base = minimumTenderAtLeast(amount, bills).total;

  if (base <= 0) {
    return [];
  }

  const ascending = [...bills].filter((bill) => bill > 0).sort((left, right) => left - right);
  if (ascending.length === 0) {
    return [];
  }

  const suggestions = [base];

  for (const bill of ascending) {
    if (suggestions.length >= MAX_QUICK_TENDERS) {
      break;
    }

    if (bill > base + EPSILON) {
      suggestions.push(bill);
    }
  }

  const largest = ascending[ascending.length - 1];
  while (suggestions.length < MAX_QUICK_TENDERS) {
    const last = suggestions[suggestions.length - 1];
    suggestions.push(
      roundMoney(Math.floor(last / largest + EPSILON) * largest + largest),
    );
  }

  return suggestions;
}

/**
 * Vuelto realmente entregable: el exacto casi nunca es multiplo de los billetes
 * disponibles, asi que el resto queda como `rounding` a favor de la gaveta.
 */
export function maxDeliverableChange(
  amount: number,
  bills: readonly number[],
): DeliverableChange {
  const breakdown = greedyBreakdown(amount, bills);

  return {
    counts: breakdown.counts,
    delivered: breakdown.covered,
    rounding: breakdown.remainder,
  };
}

/** "200x2 + 100x1 + 50x1 + 10x1" para el resumen del vuelto sugerido. */
export function formatDenominationBreakdown(
  counts: DenominationCounts,
  bills: readonly number[],
) {
  return sortBillsDesc(bills)
    .filter((bill) => toBillCount(counts[bill]) > 0)
    .map((bill) => `${bill}x${toBillCount(counts[bill])}`)
    .join(" + ");
}

/** Payload jsonb para `register_payment`; `null` cuando no se conto nada. */
export function toDenominationsPayload(
  currency: DenominationCurrency,
  counts: DenominationCounts | null | undefined,
): DenominationsPayload | null {
  if (!counts) {
    return null;
  }

  const bills = getBillsForCurrency(currency);
  const entries: Record<string, number> = {};

  for (const bill of sortBillsDesc(bills)) {
    const count = toBillCount(counts[bill]);
    if (count > 0) {
      entries[String(bill)] = count;
    }
  }

  if (Object.keys(entries).length === 0) {
    return null;
  }

  return { [currency]: entries };
}
