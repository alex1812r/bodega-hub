/**
 * Conversión USD ↔ Bs y regla de "cuánto cabe en un saldo", con enteros exactos.
 *
 * Es la ÚNICA implementación de la app: la usan el formulario de pago
 * (`PaymentFormFields/paymentForm.ts`: equivalencia, "Completar saldo", aviso de
 * sobrepago) y el reparto de un abono (`modules/payments/utils/allocatePayment.ts`),
 * de modo que los dos proponen siempre el mismo monto para el mismo documento
 * (AUD-03). Reproduce el redondeo de `register_payment` en Postgres: céntimos
 * enteros, tasa `numeric(14,4)` y mitad hacia arriba (INT-03).
 */

/** Moneda del método de pago: en ella se teclea el monto. */
export type MoneyCurrency = "USD" | "VES";

/**
 * Menor saldo en Bs que `register_payment` todavía deja pagar. Una venta con
 * saldo <= Bs 0,01 se rechaza ("no tiene saldo pendiente"), así que un parcial no
 * puede dejarle un céntimo suelto; una compra acepta cualquier saldo positivo.
 */
export const MIN_PAYABLE_VES_BY_DOCUMENT = { purchase: 0.01, sale: 0.02 } as const;

const CENTS = 100;
// La tasa viaja como entero de diezmilésimas: numeric(14,4) en el servidor.
const RATE_SCALE = 10_000;

/** Monto en céntimos enteros. Lo que no es un monto positivo vale 0. */
export function toMoneyCents(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.round(value * CENTS);
}

export function fromMoneyCents(cents: number) {
  return cents / CENTS;
}

/** Tasa Bs por USD en diezmilésimas enteras. Sin tasa válida vale 0. */
export function toRateUnits(rateVes: number | undefined) {
  if (rateVes === undefined || !Number.isFinite(rateVes) || rateVes <= 0) {
    return 0;
  }

  return Math.round(rateVes * RATE_SCALE);
}

/**
 * `round(usd * tasa, 2)` de Postgres (mitad hacia arriba) con enteros exactos:
 * `2.73 * 36.5` es 99,645 y da 99,65.
 */
export function usdCentsToVesCents(usdCents: number, rateUnits: number) {
  const scale = BigInt(RATE_SCALE);

  return Number((BigInt(usdCents) * BigInt(rateUnits) + scale / BigInt(2)) / scale);
}

/** `round(bs / tasa, 2)` de Postgres, también con enteros exactos. */
export function vesCentsToUsdCents(vesCents: number, rateUnits: number) {
  const rate = BigInt(rateUnits);
  const two = BigInt(2);

  return Number((BigInt(vesCents) * BigInt(RATE_SCALE) * two + rate) / (two * rate));
}

/**
 * Mayor monto en USD que cabe en el saldo. Cabe mientras su valor en Bs SIN redondear
 * no pase del saldo en más de medio céntimo: el medio céntimo exacto cuenta.
 *
 * Es el caso de un documento de ref 10,00 a 875,6505: su total se guardó como
 * Bs 8.756,50 (8.756,505 hacia abajo) y `register_payment` convierte 10 USD en
 * Bs 8.756,51. El servidor acepta ese céntimo (holgura de la conversión) y deja el
 * documento saldado; con 9,99 quedaría un resto de Bs 8,75 que ningún monto en USD
 * puede pagar.
 */
export function maxUsdCentsWithin(pendingCents: number, rateUnits: number) {
  const scale = BigInt(RATE_SCALE);

  return Number((BigInt(pendingCents) * scale + scale / BigInt(2)) / BigInt(rateUnits));
}

export type PayablePart = {
  /** Céntimos de Bs que el servidor descontará del saldo. */
  appliedVesCents: number;
  /** Céntimos a pagar, en la moneda del método. */
  cents: number;
};

/**
 * Lo más que `availableCents` (en la moneda del método) puede abonar a un documento
 * sin pagarlo de más y sin dejarle un saldo que el servidor ya no deje pagar
 * (0 < saldo < mínimo).
 */
export function payablePart(
  availableCents: number,
  pendingCents: number,
  rateUnits: number,
  currency: MoneyCurrency,
  minPayableCents: number,
): PayablePart {
  if (availableCents <= 0 || pendingCents < minPayableCents) {
    return { appliedVesCents: 0, cents: 0 };
  }

  if (currency === "VES") {
    let cents = Math.min(availableCents, pendingCents);
    const residue = pendingCents - cents;

    if (residue > 0 && residue < minPayableCents) {
      cents = pendingCents - minPayableCents;
    }

    return { appliedVesCents: cents, cents };
  }

  if (rateUnits <= 0) {
    return { appliedVesCents: 0, cents: 0 };
  }

  let cents = Math.min(availableCents, maxUsdCentsWithin(pendingCents, rateUnits));
  let appliedVesCents = usdCentsToVesCents(cents, rateUnits);

  while (
    cents > 0 &&
    pendingCents - appliedVesCents > 0 &&
    pendingCents - appliedVesCents < minPayableCents
  ) {
    cents -= 1;
    appliedVesCents = usdCentsToVesCents(cents, rateUnits);
  }

  return { appliedVesCents, cents };
}
