import type { CashSession } from "@/modules/cash/types";

import {
  buildVaultBucketConfirmEffects,
  computeClosuresTransferEffect,
  computeVaultCashMovementEffect,
  formatVaultSignedAmount,
  type VaultBucketEffect,
  type VaultBucketKey,
} from "./vaultEffect";

const vault = { balanceEfectivoVes: 1000.1, balanceRef: 20.3, balanceVes: 5000 };

function closure(overrides: Partial<CashSession>): CashSession {
  return {
    closedAt: "2026-10-08T21:00:00.000Z",
    closingRef: 0,
    closingVes: 0,
    id: "session-1",
    openedAt: "2026-10-08T12:00:00.000Z",
    openingRef: 0,
    openingVes: 0,
    register: {
      createdAt: "2026-10-01T12:00:00.000Z",
      id: "register-1",
      isActive: true,
      name: "Caja 1",
      storeId: "store-1",
      updatedAt: "2026-10-01T12:00:00.000Z",
    },
    registerId: "register-1",
    status: "closed",
    ...overrides,
  };
}

function bucket(effect: { buckets: VaultBucketEffect[] }, key: VaultBucketKey) {
  const found = effect.buckets.find((item) => item.key === key);

  if (!found) {
    throw new Error(`Sin cubeta ${key}`);
  }

  return found;
}

describe("computeVaultCashMovementEffect", () => {
  it("el retiro resta solo de las cubetas de efectivo y la cuenta no cambia", () => {
    const effect = computeVaultCashMovementEffect({
      amountRef: 0.2,
      amountVes: 250.05,
      kind: "withdrawal",
      vault,
    });

    expect(bucket(effect, "efectivoVes")).toMatchObject({ after: 750.05, before: 1000.1, delta: -250.05 });
    expect(bucket(effect, "efectivoRef")).toMatchObject({ after: 20.1, before: 20.3, delta: -0.2 });
    expect(bucket(effect, "cuentaVes")).toMatchObject({ after: 5000, before: 5000, delta: 0 });
    expect(effect.insufficient).toEqual({ ref: false, ves: false });
  });

  it("el depósito suma al efectivo sin arrastrar error de coma flotante", () => {
    const effect = computeVaultCashMovementEffect({
      amountRef: 0.2,
      amountVes: 0.2,
      kind: "deposit",
      vault: { balanceEfectivoVes: 0.1, balanceRef: 0.1, balanceVes: 0 },
    });

    expect(bucket(effect, "efectivoVes")).toMatchObject({ after: 0.3, delta: 0.2 });
    expect(bucket(effect, "efectivoRef")).toMatchObject({ after: 0.3, delta: 0.2 });
    expect(effect.insufficient).toEqual({ ref: false, ves: false });
  });

  it("marca como insuficiente la cubeta cuyo retiro supera el saldo, igual que rechaza la RPC", () => {
    const effect = computeVaultCashMovementEffect({
      amountRef: 20.31,
      amountVes: 1000.1,
      kind: "withdrawal",
      vault,
    });

    // Retirar exactamente el saldo está permitido; un céntimo más, no.
    expect(effect.insufficient).toEqual({ ref: true, ves: false });
    expect(bucket(effect, "efectivoVes").after).toBe(0);
  });

  it("un depósito nunca es insuficiente", () => {
    const effect = computeVaultCashMovementEffect({
      amountRef: 999,
      amountVes: 99999,
      kind: "deposit",
      vault,
    });

    expect(effect.insufficient).toEqual({ ref: false, ves: false });
  });
});

describe("computeClosuresTransferEffect", () => {
  it("suma el CONTADO de cada cierre (no el teórico) a las cubetas de efectivo", () => {
    const effect = computeClosuresTransferEffect({
      closures: [
        closure({
          closingRef: 10.1,
          closingVes: 900.1,
          id: "a",
          theoreticalClosingRef: 10.1,
          theoreticalClosingVes: 950.3,
        }),
        closure({
          closingRef: 0.2,
          closingVes: 100.2,
          id: "b",
          theoreticalClosingRef: 0,
          theoreticalClosingVes: 100,
        }),
      ],
      vault,
    });

    expect(effect.totalVes).toBe(1000.3);
    expect(effect.totalRef).toBe(10.3);
    expect(bucket(effect, "efectivoVes")).toMatchObject({ after: 2000.4, before: 1000.1 });
    expect(bucket(effect, "efectivoRef")).toMatchObject({ after: 30.6, before: 20.3 });
    expect(bucket(effect, "cuentaVes")).toMatchObject({ after: 5000, delta: 0 });
  });

  it("la diferencia es contado − teórico: negativa si falta, positiva si sobra", () => {
    const effect = computeClosuresTransferEffect({
      closures: [
        closure({
          closingRef: 0.2,
          closingVes: 900.1,
          theoreticalClosingRef: 0,
          theoreticalClosingVes: 950.3,
        }),
      ],
      vault,
    });

    expect(effect.closures[0]).toMatchObject({
      ref: { counted: 0.2, difference: 0.2, theoretical: 0 },
      registerName: "Caja 1",
      ves: { counted: 900.1, difference: -50.2, theoretical: 950.3 },
    });
  });

  it("sin teórico no inventa diferencia y conserva el aviso de cierre absorbido", () => {
    const effect = computeClosuresTransferEffect({
      closures: [
        closure({
          absorbedBySessionId: "next",
          closingVes: 50,
          theoreticalClosingRef: null,
          theoreticalClosingVes: null,
        }),
      ],
      vault,
    });

    expect(effect.closures[0].isAbsorbed).toBe(true);
    expect(effect.closures[0].ves).toEqual({ counted: 50, difference: null, theoretical: null });
  });
});

describe("buildVaultBucketConfirmEffects", () => {
  it("muestra saldo actual → resultante y «Sin cambio» en las cubetas que no se mueven", () => {
    const effect = computeVaultCashMovementEffect({
      amountRef: 0,
      amountVes: 250.05,
      kind: "withdrawal",
      vault,
    });

    expect(buildVaultBucketConfirmEffects(effect.buckets)).toEqual([
      {
        after: "Bs. 750,05",
        before: "Bs. 1.000,10",
        label: "Efectivo Bs. (−Bs. 250,05)",
        tone: "warning",
      },
      { after: "Sin cambio", before: "Bs. 5.000,00", label: "Cuenta Bs.", tone: "neutral" },
      { after: "Sin cambio", before: "ref 20.30", label: "Saldo REF", tone: "neutral" },
    ]);
  });

  it("un ingreso sale en tono positivo con el signo +", () => {
    const effect = computeVaultCashMovementEffect({
      amountRef: 5,
      amountVes: 0,
      kind: "deposit",
      vault,
    });

    expect(buildVaultBucketConfirmEffects(effect.buckets)[2]).toEqual({
      after: "ref 25.30",
      before: "ref 20.30",
      label: "Saldo REF (+ref 5.00)",
      tone: "positive",
    });
    expect(formatVaultSignedAmount("ves", -50.2)).toBe("−Bs. 50,20");
  });
});
