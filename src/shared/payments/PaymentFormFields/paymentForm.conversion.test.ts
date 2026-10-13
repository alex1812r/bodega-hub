/**
 * AUD-03: el formulario de pago y el reparto de un abono convierten USD ↔ Bs con
 * la MISMA función exacta (céntimos enteros, regla del medio céntimo de INT-03).
 * "Completar saldo" y el reparto proponen siempre el mismo monto para el mismo
 * documento.
 */
import {
  allocatePayment,
  maxAllocatableAmount,
  MIN_PAYABLE_VES_BY_DOCUMENT,
} from "@/modules/payments/utils/allocatePayment";

import {
  amountForMethodChange,
  amountForPendingShare,
  createEmptyPaymentFormValues,
  paymentAmountEquivalent,
  paymentOverpayment,
  PENDING_BALANCE_SHARES,
} from "./paymentForm";

const KINDS = ["purchase", "sale"] as const;

/** Generador determinista (mulberry32): las propiedades fallan siempre con el mismo caso. */
function createRandom(seed: number) {
  let state = seed;

  return () => {
    state = (state + 0x6d2b79f5) | 0;

    let value = Math.imul(state ^ (state >>> 15), 1 | state);

    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;

    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function integerBetween(random: () => number, min: number, max: number) {
  return min + Math.floor(random() * (max - min + 1));
}

/** `round(usd * tasa, 2)` de Postgres, con enteros: la referencia independiente del test. */
function serverVesCents(usdCents: number, rateUnits: number) {
  return Number((BigInt(usdCents) * BigInt(rateUnits) + BigInt(5000)) / BigInt(10000));
}

function usdValues(amount: number) {
  return { ...createEmptyPaymentFormValues("efectivo_usd"), amount: String(amount) };
}

/** Tasas de 4 decimales entre 30 y 950 Bs por USD, como diezmilésimas enteras. */
function randomRateUnits(random: () => number) {
  return integerBetween(random, 300_000, 9_500_000);
}

describe("conversión exacta en el formulario de pago (AUD-03)", () => {
  it("la equivalencia en vivo es la que descuenta el servidor: 2,73 USD a 36,5 son Bs 99,65", () => {
    // 2.73 * 36.5 = 99.645: en coma flotante salía 99.64.
    expect(paymentAmountEquivalent("efectivo_usd", "2.73", 36.5)).toEqual({
      currency: "VES",
      value: 99.65,
    });
    expect(amountForMethodChange("efectivo_usd", "efectivo_ves", "2.73", 36.5)).toBe("99.65");
  });

  it("la equivalencia de Bs a USD redondea el medio céntimo hacia arriba", () => {
    // 40.20 / 40 = 1.005 → 1.01.
    expect(paymentAmountEquivalent("efectivo_ves", "40.20", 40)).toEqual({ currency: "USD", value: 1.01 });
    // 1.15 / 2 = 0.575 → 0.58; en coma flotante 0.575 es 0.57499… y daba 0.57.
    expect(paymentAmountEquivalent("efectivo_ves", "1.15", 2)).toEqual({ currency: "USD", value: 0.58 });
  });

  it("empate de medio céntimo: 10 USD a 875,6505 saldan Bs 8.756,50 y no se avisa de sobrepago", () => {
    const doc = { pendingVes: 8756.5, rateVes: 875.6505 };

    expect(amountForPendingShare("efectivo_usd", doc.pendingVes, 100, doc.rateVes)).toBe(10);
    expect(maxAllocatableAmount({ currency: "USD", documents: [doc] })).toBe(10);
    expect(paymentOverpayment(usdValues(10), { pendingBalance: 8756.5, rateVes: 875.6505 })).toBeNull();
    // Un céntimo de dólar más ya no cabe.
    expect(
      paymentOverpayment(usdValues(10.01), { pendingBalance: 8756.5, rateVes: 875.6505 }),
    ).toMatchObject({ blocking: false });
  });

  it("empate de medio céntimo: 2,73 USD a 36,5 caben en Bs 99,64 y no en Bs 99,63", () => {
    expect(amountForPendingShare("efectivo_usd", 99.64, 100, 36.5)).toBe(2.73);
    expect(maxAllocatableAmount({ currency: "USD", documents: [{ pendingVes: 99.64, rateVes: 36.5 }] })).toBe(2.73);
    expect(paymentOverpayment(usdValues(2.73), { pendingBalance: 99.64, rateVes: 36.5 })).toBeNull();

    expect(amountForPendingShare("efectivo_usd", 99.63, 100, 36.5)).toBe(2.72);
    expect(maxAllocatableAmount({ currency: "USD", documents: [{ pendingVes: 99.63, rateVes: 36.5 }] })).toBe(2.72);
    expect(paymentOverpayment(usdValues(2.73), { pendingBalance: 99.63, rateVes: 36.5 })).not.toBeNull();
  });

  it("el sobrepago bloquea con los Bs exactos que descontará el servidor", () => {
    // 2.73 USD = Bs 99,65 exactos; con holgura de 1 céntimo sobre Bs 99,64 no bloquea.
    expect(
      paymentOverpayment(usdValues(2.74), {
        overpayToleranceVes: 0.01,
        pendingBalance: 99.64,
        rateVes: 36.5,
      }),
    ).toMatchObject({ blocking: true });
    expect(
      paymentOverpayment(usdValues(2.73), {
        overpayToleranceVes: 0.01,
        pendingBalance: 99.63,
        rateVes: 36.5,
      }),
    ).toMatchObject({ blocking: true });
    expect(
      paymentOverpayment(usdValues(2.73), {
        overpayToleranceVes: 0.02,
        pendingBalance: 99.63,
        rateVes: 36.5,
      }),
    ).toMatchObject({ blocking: false });
  });

  it("una venta no se deja con un céntimo suelto: «Completar saldo» propone lo mismo que el reparto", () => {
    // 2.73 USD = Bs 99,65: con saldo 99,66 quedaría Bs 0,01, que una venta ya no deja pagar.
    const doc = { pendingVes: 99.66, rateVes: 36.5 };
    const sale = MIN_PAYABLE_VES_BY_DOCUMENT.sale;
    const purchase = MIN_PAYABLE_VES_BY_DOCUMENT.purchase;

    expect(amountForPendingShare("efectivo_usd", 99.66, 100, 36.5, sale)).toBe(2.72);
    expect(maxAllocatableAmount({ currency: "USD", documents: [doc], minPayableVes: sale })).toBe(2.72);
    expect(amountForPendingShare("efectivo_usd", 99.66, 100, 36.5, purchase)).toBe(2.73);
    expect(maxAllocatableAmount({ currency: "USD", documents: [doc], minPayableVes: purchase })).toBe(2.73);
    // Sin decir el tipo de documento vale la regla de la compra (Bs 0,01).
    expect(amountForPendingShare("efectivo_usd", 99.66, 100, 36.5)).toBe(2.73);
  });

  describe("propiedades con tasas de 4 decimales", () => {
    it("«Completar saldo» en USD = mayor abono que el reparto aplica al documento", () => {
      const random = createRandom(20261010);

      for (let run = 0; run < 3000; run += 1) {
        const rateVes = randomRateUnits(random) / 10_000;
        const pendingVes = integerBetween(random, 1, 5_000_000) / 100;
        const minPayableVes = MIN_PAYABLE_VES_BY_DOCUMENT[KINDS[run % 2]];
        const documents = [{ pendingVes, rateVes }];
        const expected = maxAllocatableAmount({ currency: "USD", documents, minPayableVes });
        const complete = amountForPendingShare("efectivo_usd", pendingVes, 100, rateVes, minPayableVes);

        expect([pendingVes, rateVes, minPayableVes, complete ?? 0]).toEqual([
          pendingVes,
          rateVes,
          minPayableVes,
          expected,
        ]);
      }
    });

    it("«Completar saldo» en Bs = mayor abono que el reparto aplica al documento", () => {
      const random = createRandom(7);

      for (let run = 0; run < 1000; run += 1) {
        const pendingVes = integerBetween(random, 1, 5_000_000) / 100;
        const minPayableVes = MIN_PAYABLE_VES_BY_DOCUMENT[KINDS[run % 2]];
        const expected = maxAllocatableAmount({
          currency: "VES",
          documents: [{ pendingVes }],
          minPayableVes,
        });

        expect([pendingVes, amountForPendingShare("efectivo_ves", pendingVes, 100, undefined, minPayableVes) ?? 0]).toEqual([
          pendingVes,
          expected,
        ]);
      }
    });

    it("cada atajo (25, 50, 100 %) es un abono que el reparto aplica entero y sin aviso de sobrepago", () => {
      const random = createRandom(99);

      for (let run = 0; run < 3000; run += 1) {
        const rateVes = randomRateUnits(random) / 10_000;
        const pendingVes = integerBetween(random, 1, 5_000_000) / 100;
        const minPayableVes = MIN_PAYABLE_VES_BY_DOCUMENT[KINDS[run % 2]];
        const method = run % 3 === 0 ? ("efectivo_ves" as const) : ("efectivo_usd" as const);
        const currency = method === "efectivo_usd" ? ("USD" as const) : ("VES" as const);

        for (const percent of PENDING_BALANCE_SHARES) {
          const amount = amountForPendingShare(method, pendingVes, percent, rateVes, minPayableVes);

          if (amount === null) {
            continue;
          }

          const result = allocatePayment({
            amount,
            currency,
            documents: [{ pendingVes, rateVes }],
            minPayableVes,
          });
          const context = [pendingVes, rateVes, minPayableVes, method, percent, amount];

          expect([...context, result.leftover, result.allocations[0]?.amount]).toEqual([
            ...context,
            0,
            amount,
          ]);
          expect([
            ...context,
            paymentOverpayment(
              { ...createEmptyPaymentFormValues(method), amount: String(amount) },
              { pendingBalance: pendingVes, rateVes },
            ),
          ]).toEqual([...context, null]);
        }
      }
    });

    it("la equivalencia de USD a Bs coincide con `round(usd * tasa, 2)` del servidor y con el reparto", () => {
      const random = createRandom(42);

      for (let run = 0; run < 3000; run += 1) {
        const rateUnits = randomRateUnits(random);
        const usdCents = integerBetween(random, 1, 2_000_000);
        const rateVes = rateUnits / 10_000;
        const amount = usdCents / 100;
        const expected = serverVesCents(usdCents, rateUnits) / 100;
        const allocated = allocatePayment({
          amount,
          currency: "USD",
          documents: [{ pendingVes: 1e12, rateVes }],
        });

        expect([amount, rateVes, paymentAmountEquivalent("efectivo_usd", String(amount), rateVes)?.value]).toEqual([
          amount,
          rateVes,
          expected,
        ]);
        expect([amount, rateVes, allocated.allocations[0].appliedVes]).toEqual([amount, rateVes, expected]);
      }
    });

    it("la equivalencia de Bs a USD es la que muestra el reparto para ese abono", () => {
      const random = createRandom(11);

      for (let run = 0; run < 3000; run += 1) {
        const rateVes = randomRateUnits(random) / 10_000;
        const amount = integerBetween(random, 1, 5_000_000) / 100;
        const allocated = allocatePayment({
          amount,
          currency: "VES",
          documents: [{ pendingVes: 1e9, rateVes }],
        });

        expect([amount, rateVes, paymentAmountEquivalent("efectivo_ves", String(amount), rateVes)?.value]).toEqual([
          amount,
          rateVes,
          allocated.allocations[0].equivalent,
        ]);
      }
    });

    it("empates de medio céntimo: el monto que cae justo en ,xx5 cabe en el saldo redondeado hacia abajo", () => {
      const random = createRandom(5);
      let ties = 0;

      while (ties < 500) {
        // usdCents * rateUnits acabado en 5000 diezmilésimas de céntimo = medio céntimo exacto.
        const usdCents = integerBetween(random, 1, 400_000) * 2;
        const rateUnits = integerBetween(random, 120, 3_800) * 2_500;

        if ((usdCents * rateUnits) % 10_000 !== 5_000) {
          continue;
        }

        ties += 1;

        const rateVes = rateUnits / 10_000;
        const amount = usdCents / 100;
        const roundedUp = serverVesCents(usdCents, rateUnits);
        // Saldo guardado un céntimo por debajo de lo que el servidor descontará.
        const pendingVes = (roundedUp - 1) / 100;
        const context = [amount, rateVes];

        expect([...context, paymentAmountEquivalent("efectivo_usd", String(amount), rateVes)?.value]).toEqual([
          ...context,
          roundedUp / 100,
        ]);
        expect([...context, amountForPendingShare("efectivo_usd", pendingVes, 100, rateVes)]).toEqual([
          ...context,
          amount,
        ]);
        expect([
          ...context,
          maxAllocatableAmount({ currency: "USD", documents: [{ pendingVes, rateVes }] }),
        ]).toEqual([...context, amount]);
        expect([
          ...context,
          paymentOverpayment(usdValues(amount), { pendingBalance: pendingVes, rateVes }),
        ]).toEqual([...context, null]);
        // Dos céntimos por debajo ya no cabe: hay que proponer un céntimo de dólar menos.
        expect([
          ...context,
          amountForPendingShare("efectivo_usd", (roundedUp - 2) / 100, 100, rateVes),
        ]).toEqual([...context, (usdCents - 1) / 100]);
      }
    });
  });
});
