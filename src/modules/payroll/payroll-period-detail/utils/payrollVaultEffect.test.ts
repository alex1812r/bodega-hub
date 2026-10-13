import { computePayrollVaultEffect, resolvePayrollVaultBucket } from "./payrollVaultEffect";

const vault = { balanceEfectivoVes: 5000, balanceRef: 800, balanceVes: 3000 };

describe("payrollVaultEffect (CNF-13)", () => {
  it("cada método toca la cubeta que usa `pay_payroll_item`", () => {
    expect(resolvePayrollVaultBucket("efectivo_ves")).toBe("efectivoVes");
    expect(resolvePayrollVaultBucket("efectivo_usd")).toBe("efectivoRef");
    expect(resolvePayrollVaultBucket("pago_movil")).toBe("cuentaVes");
    expect(resolvePayrollVaultBucket("transferencia")).toBe("cuentaVes");
    expect(resolvePayrollVaultBucket("punto_venta")).toBeNull();
    expect(resolvePayrollVaultBucket(null)).toBeNull();
  });

  it("pagar descuenta la suma de los recibos de una sola cubeta, sin coma flotante", () => {
    const effect = computePayrollVaultEffect({
      amounts: [0.1, 0.2],
      direction: "out",
      method: "pago_movil",
      vault,
    });

    expect(effect).toMatchObject({ amount: 0.3, bucketKey: "cuentaVes", insufficient: false });
    expect(effect?.buckets.map(({ after, delta, key }) => ({ after, delta, key }))).toEqual([
      { after: 5000, delta: 0, key: "efectivoVes" },
      { after: 2999.7, delta: -0.3, key: "cuentaVes" },
      { after: 800, delta: 0, key: "efectivoRef" },
    ]);
  });

  it("marca insuficiente solo cuando el total supera el saldo de su cubeta", () => {
    const exact = computePayrollVaultEffect({
      amounts: [800],
      direction: "out",
      method: "efectivo_usd",
      vault,
    });
    const over = computePayrollVaultEffect({
      amounts: [500, 300.01],
      direction: "out",
      method: "efectivo_usd",
      vault,
    });

    expect(exact?.insufficient).toBe(false);
    expect(over?.insufficient).toBe(true);
  });

  it("anular devuelve el monto a la misma cubeta y nunca es insuficiente", () => {
    const effect = computePayrollVaultEffect({
      amounts: [9000],
      direction: "in",
      method: "efectivo_ves",
      vault,
    });

    expect(effect).toMatchObject({ amount: 9000, bucketKey: "efectivoVes", insufficient: false });
    expect(effect?.buckets[0]).toMatchObject({ after: 14000, before: 5000, delta: 9000 });
  });

  it("un método que la nómina no usa no tiene efecto calculable", () => {
    expect(
      computePayrollVaultEffect({ amounts: [10], direction: "out", method: "punto_venta", vault }),
    ).toBeNull();
  });
});
