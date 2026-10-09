/** Moneda del metodo de pago: en ella se teclea el monto y se envia cada parte. */
export type AllocationCurrency = "USD" | "VES";

export type AllocationDocument = {
  /** Saldo pendiente del documento en Bs. */
  pendingVes: number;
  /**
   * Tasa Bs por USD con la que `register_payment` convertira un pago a ESTE
   * documento (numeric(14,4)): la de la venta, o la del dia en una compra. Solo
   * hace falta con metodo en USD; sin ella el documento no recibe nada.
   */
  rateVes?: number;
};

/**
 * Menor saldo en Bs que `register_payment` todavia deja pagar. Una venta con
 * saldo <= Bs 0,01 se rechaza ("no tiene saldo pendiente"), asi que un parcial no
 * puede dejarle un centimo suelto; una compra acepta cualquier saldo positivo.
 */
export const MIN_PAYABLE_VES_BY_DOCUMENT = { purchase: 0.01, sale: 0.02 } as const;

export type AllocatePaymentInput<TDocument extends AllocationDocument> = {
  /** Monto del abono en la moneda del metodo. */
  amount: number;
  currency: AllocationCurrency;
  /** Del mas antiguo al mas nuevo: en ese orden reciben el dinero. */
  documents: readonly TDocument[];
  /** Ver `MIN_PAYABLE_VES_BY_DOCUMENT`. Por defecto Bs 0,01. */
  minPayableVes?: number;
};

export type PaymentAllocation<TDocument extends AllocationDocument> = {
  /** Monto a enviar en `POST /api/payments`, en la moneda del metodo. */
  amount: number;
  /**
   * Bs que el servidor descontara del saldo del documento. Con metodo en USD puede
   * superar el saldo en Bs 0,01 (medio centimo de la conversion, ver
   * `maxUsdCentsWithin`); `remainingVes` queda entonces en 0.
   */
  appliedVes: number;
  document: TDocument;
  /**
   * El mismo monto en la otra moneda, a la tasa del documento: Bs si el metodo es
   * en USD, USD si es en Bs. `null` sin tasa (solo posible con metodo en Bs).
   */
  equivalent: number | null;
  /** Saldo en Bs que le queda al documento despues del abono. */
  remainingVes: number;
};

export type PaymentAllocationResult<TDocument extends AllocationDocument> = {
  /** Solo los documentos que reciben dinero, en el orden recibido. */
  allocations: PaymentAllocation<TDocument>[];
  /** Suma de las partes, en la moneda del metodo. `amount = appliedAmount + leftover`. */
  appliedAmount: number;
  /** Suma de los Bs descontados de los saldos. */
  appliedVes: number;
  /** Parte del monto que ningun documento puede recibir, en la moneda del metodo. */
  leftover: number;
};

const CENTS = 100;
// La tasa viaja como entero de diezmilesimas: numeric(14,4) en el servidor.
const RATE_SCALE = 10_000;

function toCents(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.round(value * CENTS);
}

function toRateUnits(rateVes: number | undefined) {
  if (rateVes === undefined || !Number.isFinite(rateVes) || rateVes <= 0) {
    return 0;
  }

  return Math.round(rateVes * RATE_SCALE);
}

/**
 * `round(usd * tasa, 2)` de Postgres (mitad hacia arriba) con enteros exactos:
 * `2.73 * 36.5` es 99,645 y da 99,65; en coma flotante saldria 99,64.
 */
function usdCentsToVesCents(usdCents: number, rateUnits: number) {
  const scale = BigInt(RATE_SCALE);

  return Number((BigInt(usdCents) * BigInt(rateUnits) + scale / BigInt(2)) / scale);
}

/** `round(bs / tasa, 2)` de Postgres, tambien con enteros exactos. */
function vesCentsToUsdCents(vesCents: number, rateUnits: number) {
  const rate = BigInt(rateUnits);
  const two = BigInt(2);

  return Number((BigInt(vesCents) * BigInt(RATE_SCALE) * two + rate) / (two * rate));
}

/**
 * Mayor monto en USD que cabe en el saldo. Cabe mientras su valor en Bs SIN redondear
 * no pase del saldo en mas de medio centimo: el medio centimo exacto cuenta.
 *
 * Es el caso de un documento de ref 10,00 a 875,6505: su total se guardo como
 * Bs 8.756,50 (8.756,505 hacia abajo) y `register_payment` convierte 10 USD en
 * Bs 8.756,51. El servidor acepta ese centimo (holgura de la conversion) y deja el
 * documento saldado, igual que "Completar saldo" desde su detalle; con 9,99 quedaria
 * un resto de Bs 8,75 que ningun monto en USD puede pagar.
 */
function maxUsdCentsWithin(pendingCents: number, rateUnits: number) {
  const scale = BigInt(RATE_SCALE);

  return Number((BigInt(pendingCents) * scale + scale / BigInt(2)) / BigInt(rateUnits));
}

type Part = { appliedVesCents: number; cents: number };

/**
 * Lo mas que `availableCents` puede abonar a un documento sin pagarlo de mas y sin
 * dejarle un saldo que el servidor ya no deje pagar (0 < saldo < minimo).
 */
function takePart(
  availableCents: number,
  pendingCents: number,
  rateUnits: number,
  currency: AllocationCurrency,
  minPayableCents: number,
): Part {
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

function distribute<TDocument extends AllocationDocument>(
  amountCents: number,
  { currency, documents, minPayableVes = 0.01 }: Omit<AllocatePaymentInput<TDocument>, "amount">,
) {
  const minPayableCents = Math.max(toCents(minPayableVes), 1);
  const allocations: PaymentAllocation<TDocument>[] = [];
  let availableCents = amountCents;
  let appliedVesCents = 0;

  for (const document of documents) {
    if (availableCents <= 0) {
      break;
    }

    const pendingCents = toCents(document.pendingVes);
    const rateUnits = toRateUnits(document.rateVes);
    const part = takePart(availableCents, pendingCents, rateUnits, currency, minPayableCents);

    if (part.cents <= 0) {
      continue;
    }

    availableCents -= part.cents;
    appliedVesCents += part.appliedVesCents;

    let equivalent: number | null = part.appliedVesCents / CENTS;

    if (currency === "VES") {
      equivalent = rateUnits > 0 ? vesCentsToUsdCents(part.cents, rateUnits) / CENTS : null;
    }

    allocations.push({
      amount: part.cents / CENTS,
      appliedVes: part.appliedVesCents / CENTS,
      document,
      equivalent,
      // En USD el servidor puede descontar Bs 0,01 mas que el saldo (medio centimo de
      // la conversion): el documento queda saldado, no con saldo negativo.
      remainingVes: Math.max(pendingCents - part.appliedVesCents, 0) / CENTS,
    });
  }

  return { allocations, appliedCents: amountCents - availableCents, appliedVesCents };
}

/**
 * Reparte un abono entre documentos con saldo, del mas antiguo al mas nuevo.
 *
 * - Cada documento recibe lo mas que admite sin pagarse de mas; lo que no cabe pasa
 *   al siguiente y lo que no cabe en ninguno vuelve en `leftover`.
 * - Todo se calcula en centimos enteros: la suma de las partes es exactamente el
 *   monto aplicado y ningun saldo queda negativo.
 * - Con metodo en USD cada documento convierte con SU tasa y con el redondeo del
 *   servidor. Un documento "cubierto" puede conservar el resto en Bs que no llega a
 *   un centimo de dolar: se muestra en `remainingVes`.
 * - Ningun parcial deja un saldo que el servidor ya no deje pagar
 *   (`minPayableVes`): se abona un centimo menos y ese centimo sigue al siguiente.
 */
export function allocatePayment<TDocument extends AllocationDocument>({
  amount,
  ...rest
}: AllocatePaymentInput<TDocument>): PaymentAllocationResult<TDocument> {
  const amountCents = toCents(amount);
  const { allocations, appliedCents, appliedVesCents } = distribute(amountCents, rest);

  return {
    allocations,
    appliedAmount: appliedCents / CENTS,
    appliedVes: appliedVesCents / CENTS,
    leftover: (amountCents - appliedCents) / CENTS,
  };
}

/** Mayor abono, en la moneda del metodo, que el reparto aplica completo (sin sobrante). */
export function maxAllocatableAmount<TDocument extends AllocationDocument>(
  input: Omit<AllocatePaymentInput<TDocument>, "amount">,
): number {
  return distribute(Number.MAX_SAFE_INTEGER, input).appliedCents / CENTS;
}
