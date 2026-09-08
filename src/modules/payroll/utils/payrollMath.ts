import { roundMoney } from "@bodega/core";

/**
 * Cálculo puro de la nómina de cajeros.
 *
 * Regla única: el cajero cobra un porcentaje de las ventas que él mismo generó y
 * que ya están cobradas. No hay sueldo fijo. La comisión se redondea **por venta**
 * para que el detalle sea auditable línea a línea, y el total del ítem nunca baja
 * de cero aunque los reversos superen lo devengado en la quincena.
 */

/** `normal`: venta de la quincena. `late`: venta vieja cobrada tarde. `reversal`: venta ya comisionada que se canceló o devolvió. */
export type PayrollCommissionKind = "normal" | "late" | "reversal";

export type PayrollCommissionEntry = {
  commissionRef: number;
  kind: PayrollCommissionKind;
  saleTotalRef: number;
};

export type PayrollItemTotals = {
  commissionRef: number;
  reversalRef: number;
  salesCount: number;
  salesRef: number;
  totalRef: number;
};

/** Comisión de una venta, redondeada a 2 decimales. Porcentajes fuera de 0-100 se recortan. */
export function commissionForSale(saleTotalRef: number, commissionPct: number) {
  if (!Number.isFinite(saleTotalRef) || !Number.isFinite(commissionPct)) {
    return 0;
  }

  const pct = Math.min(100, Math.max(0, commissionPct));

  return roundMoney(saleTotalRef * (pct / 100));
}

/**
 * Entrada de reverso: la comisión que se le quita al cajero por una venta que ya
 * había comisionado. Siempre negativa (o cero).
 */
export function reversalEntry(
  saleTotalRef: number,
  commissionedRef: number,
): PayrollCommissionEntry {
  return {
    commissionRef: -Math.abs(roundMoney(commissionedRef)),
    kind: "reversal",
    saleTotalRef,
  };
}

/**
 * Totales de un ítem (un cajero en una quincena).
 *
 * - `salesCount` / `salesRef`: solo ventas comisionables (`normal` + `late`).
 * - `reversalRef`: suma de reversos, negativa o cero.
 * - `totalRef`: nunca negativo. Si los reversos superan la comisión, el cajero
 *   cobra 0 esa quincena y la diferencia **no** se arrastra (regla simple y documentada).
 */
export function sumItem(entries: readonly PayrollCommissionEntry[]): PayrollItemTotals {
  let commissionRef = 0;
  let reversalRef = 0;
  let salesCount = 0;
  let salesRef = 0;

  for (const entry of entries) {
    if (entry.kind === "reversal") {
      reversalRef += entry.commissionRef;
      continue;
    }

    salesCount += 1;
    salesRef += entry.saleTotalRef;
    commissionRef += entry.commissionRef;
  }

  const rounded = {
    commissionRef: roundMoney(commissionRef),
    reversalRef: roundMoney(reversalRef),
    salesRef: roundMoney(salesRef),
  };

  return {
    ...rounded,
    salesCount,
    totalRef: Math.max(0, roundMoney(rounded.commissionRef + rounded.reversalRef)),
  };
}

/** Suma los totales de varios ítems para la cabecera de la quincena. */
export function sumPeriod(items: readonly PayrollItemTotals[]) {
  const totals = items.reduce(
    (accumulator, item) => ({
      commissionRef: accumulator.commissionRef + item.commissionRef,
      reversalRef: accumulator.reversalRef + item.reversalRef,
      salesCount: accumulator.salesCount + item.salesCount,
      salesRef: accumulator.salesRef + item.salesRef,
      totalRef: accumulator.totalRef + item.totalRef,
    }),
    { commissionRef: 0, reversalRef: 0, salesCount: 0, salesRef: 0, totalRef: 0 },
  );

  return {
    commissionRef: roundMoney(totals.commissionRef),
    reversalRef: roundMoney(totals.reversalRef),
    salesCount: totals.salesCount,
    salesRef: roundMoney(totals.salesRef),
    totalRef: roundMoney(totals.totalRef),
  };
}

/**
 * Qué parte de la ganancia bruta se va en comisiones. Solo informa (semáforo);
 * nunca bloquea un pago. Sin ganancia bruta (o negativa) no hay porcentaje que
 * mostrar: devuelve `null` en vez de dividir por cero.
 */
export function shareOfGrossProfit(commissionRef: number, grossProfitRef: number | null) {
  if (grossProfitRef == null || !Number.isFinite(grossProfitRef) || grossProfitRef <= 0) {
    return null;
  }

  return roundMoney((commissionRef / grossProfitRef) * 100);
}

export type PayrollSemaphoreLevel = "ambar" | "rojo" | "sin-datos" | "verde";

/** Por debajo de este porcentaje la comisión se considera cómoda. */
export const PAYROLL_HEALTHY_SHARE_PCT = 25;

/**
 * Con el umbral por defecto (40 %): verde < 25 %, ámbar 25-40 %, rojo > 40 %.
 * Si el dueño baja el umbral por debajo de 25 %, la banda ámbar desaparece.
 */
export function semaphoreLevel(
  sharePct: number | null,
  warnSharePct: number,
): PayrollSemaphoreLevel {
  if (sharePct == null) {
    return "sin-datos";
  }

  if (sharePct > warnSharePct) {
    return "rojo";
  }

  return sharePct >= Math.min(PAYROLL_HEALTHY_SHARE_PCT, warnSharePct) ? "ambar" : "verde";
}

/**
 * Desglose informativo para el dueño: lo que queda de la ganancia bruta después de
 * pagar comisiones, y cuánto de eso sugieren los parámetros reinvertir y reservar.
 */
export function ownerBreakdown(
  grossProfitRef: number | null,
  commissionRef: number,
  reinvestPct: number,
  reservePct: number,
) {
  if (grossProfitRef == null || !Number.isFinite(grossProfitRef)) {
    return null;
  }

  const afterCommissionRef = roundMoney(grossProfitRef - commissionRef);
  const base = Math.max(0, afterCommissionRef);

  return {
    afterCommissionRef,
    freeRef: roundMoney(
      base - roundMoney(base * (reinvestPct / 100)) - roundMoney(base * (reservePct / 100)),
    ),
    reinvestRef: roundMoney(base * (reinvestPct / 100)),
    reserveRef: roundMoney(base * (reservePct / 100)),
  };
}
