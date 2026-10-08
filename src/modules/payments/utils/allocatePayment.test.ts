import {
  MIN_PAYABLE_VES_BY_DOCUMENT,
  allocatePayment,
  maxAllocatableAmount,
} from "./allocatePayment";

type Doc = { id: string; pendingVes: number; rateVes?: number };

function doc(id: string, pendingVes: number, rateVes?: number): Doc {
  return { id, pendingVes, rateVes };
}

function summary(result: ReturnType<typeof allocatePayment<Doc>>) {
  return result.allocations.map((allocation) => [
    allocation.document.id,
    allocation.amount,
    allocation.remainingVes,
  ]);
}

function cents(value: number) {
  return Math.round(value * 100);
}

describe("allocatePayment", () => {
  const three = [doc("a", 100), doc("b", 250.5), doc("c", 80)];

  describe("metodo en Bs", () => {
    it("monto exacto: cubre todos los documentos y no sobra nada", () => {
      const result = allocatePayment({ amount: 430.5, currency: "VES", documents: three });

      expect(summary(result)).toEqual([
        ["a", 100, 0],
        ["b", 250.5, 0],
        ["c", 80, 0],
      ]);
      expect(result.appliedAmount).toBe(430.5);
      expect(result.appliedVes).toBe(430.5);
      expect(result.leftover).toBe(0);
    });

    it("monto menor que el primero: solo abona al mas antiguo", () => {
      const result = allocatePayment({ amount: 40.25, currency: "VES", documents: three });

      expect(summary(result)).toEqual([["a", 40.25, 59.75]]);
      expect(result.leftover).toBe(0);
    });

    it("cubre dos documentos y medio", () => {
      const result = allocatePayment({ amount: 390.5, currency: "VES", documents: three });

      expect(summary(result)).toEqual([
        ["a", 100, 0],
        ["b", 250.5, 0],
        ["c", 40, 40],
      ]);
      expect(result.leftover).toBe(0);
    });

    it("monto mayor que el total: devuelve el sobrante sin pagar de mas", () => {
      const result = allocatePayment({ amount: 500, currency: "VES", documents: three });

      expect(result.appliedAmount).toBe(430.5);
      expect(result.leftover).toBe(69.5);
      expect(result.allocations.every((allocation) => allocation.remainingVes === 0)).toBe(true);
    });

    it("lista vacia: todo el monto es sobrante", () => {
      const result = allocatePayment({ amount: 25, currency: "VES", documents: [] });

      expect(result).toEqual({ allocations: [], appliedAmount: 0, appliedVes: 0, leftover: 25 });
    });

    it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])(
      "monto no valido (%p): no reparte nada",
      (amount) => {
        const result = allocatePayment({ amount, currency: "VES", documents: three });

        expect(result).toEqual({ allocations: [], appliedAmount: 0, appliedVes: 0, leftover: 0 });
      },
    );

    it("saldos de centimos: suma exacta sin deriva de coma flotante", () => {
      const documents = [doc("a", 0.1), doc("b", 0.2), doc("c", 0.07), doc("d", 0.03)];
      const result = allocatePayment({ amount: 0.35, currency: "VES", documents });

      expect(summary(result)).toEqual([
        ["a", 0.1, 0],
        ["b", 0.2, 0],
        ["c", 0.05, 0.02],
      ]);
      expect(result.appliedAmount).toBe(0.35);
      expect(result.leftover).toBe(0);
    });

    it("da el equivalente en USD a la tasa del documento y null sin tasa", () => {
      const result = allocatePayment({
        amount: 150,
        currency: "VES",
        documents: [doc("a", 100, 36.5), doc("b", 100)],
      });

      // round(100 / 36.5, 2) = 2.74
      expect(result.allocations[0].equivalent).toBe(2.74);
      expect(result.allocations[1].equivalent).toBeNull();
    });

    it("venta: un parcial no deja un centimo que el servidor ya no deje cobrar", () => {
      const result = allocatePayment({
        amount: 99.99,
        currency: "VES",
        documents: [doc("a", 100), doc("b", 50)],
        minPayableVes: MIN_PAYABLE_VES_BY_DOCUMENT.sale,
      });

      expect(summary(result)).toEqual([
        ["a", 99.98, 0.02],
        ["b", 0.01, 49.99],
      ]);
      expect(result.appliedAmount).toBe(99.99);
      expect(result.leftover).toBe(0);
    });

    it("venta: el centimo que no cabe en ningun documento es sobrante", () => {
      const result = allocatePayment({
        amount: 99.99,
        currency: "VES",
        documents: [doc("a", 100)],
        minPayableVes: MIN_PAYABLE_VES_BY_DOCUMENT.sale,
      });

      expect(summary(result)).toEqual([["a", 99.98, 0.02]]);
      expect(result.leftover).toBe(0.01);
    });

    it("venta: salta un documento con saldo de un centimo, que el servidor rechaza", () => {
      const result = allocatePayment({
        amount: 10,
        currency: "VES",
        documents: [doc("a", 0.01), doc("b", 30)],
        minPayableVes: MIN_PAYABLE_VES_BY_DOCUMENT.sale,
      });

      expect(summary(result)).toEqual([["b", 10, 20]]);
    });

    it("compra: un saldo de un centimo se puede dejar y se puede pagar", () => {
      const partial = allocatePayment({
        amount: 99.99,
        currency: "VES",
        documents: [doc("a", 100)],
        minPayableVes: MIN_PAYABLE_VES_BY_DOCUMENT.purchase,
      });
      const cent = allocatePayment({
        amount: 0.01,
        currency: "VES",
        documents: [doc("a", 0.01)],
        minPayableVes: MIN_PAYABLE_VES_BY_DOCUMENT.purchase,
      });

      expect(summary(partial)).toEqual([["a", 99.99, 0.01]]);
      expect(summary(cent)).toEqual([["a", 0.01, 0]]);
    });
  });

  describe("metodo en USD", () => {
    it("convierte cada documento con su propia tasa", () => {
      const documents = [doc("a", 365, 36.5), doc("b", 400, 40), doc("c", 500, 50)];
      const result = allocatePayment({ amount: 25, currency: "USD", documents });

      expect(
        result.allocations.map((allocation) => [
          allocation.document.id,
          allocation.amount,
          allocation.appliedVes,
          allocation.equivalent,
          allocation.remainingVes,
        ]),
      ).toEqual([
        ["a", 10, 365, 365, 0],
        ["b", 10, 400, 400, 0],
        ["c", 5, 250, 250, 250],
      ]);
      expect(result.appliedAmount).toBe(25);
      expect(result.appliedVes).toBe(1015);
      expect(result.leftover).toBe(0);
    });

    it("nunca paga de mas: baja al centimo de dolar que cabe y muestra el resto en Bs", () => {
      // 100 / 36.5 = 2.7397…: 2.74 USD serian Bs 100,01 (de mas); 2.73 USD son Bs 99,65.
      const result = allocatePayment({
        amount: 5,
        currency: "USD",
        documents: [doc("a", 100, 36.5)],
      });

      expect(result.allocations[0]).toMatchObject({
        amount: 2.73,
        appliedVes: 99.65,
        remainingVes: 0.35,
      });
      expect(result.leftover).toBe(2.27);
    });

    it("redondea como Postgres (mitad hacia arriba), no como la coma flotante", () => {
      // 2.73 * 36.5 = 99,645 exacto → 99,65. En JS, 2.73 * 36.5 = 99.64499999999998.
      const result = allocatePayment({
        amount: 2.73,
        currency: "USD",
        documents: [doc("a", 99.64, 36.5)],
      });

      // Bs 99,65 superaria el saldo de Bs 99,64: solo caben 2.72 USD.
      expect(result.allocations[0].amount).toBe(2.72);
      expect(result.leftover).toBe(0.01);
    });

    it("mayor que el total: sobrante positivo", () => {
      const documents = [doc("a", 365, 36.5), doc("b", 400, 40)];
      const result = allocatePayment({ amount: 50, currency: "USD", documents });

      expect(result.appliedAmount).toBe(20);
      expect(result.leftover).toBe(30);
    });

    it("sin tasa valida el documento no recibe nada", () => {
      const result = allocatePayment({
        amount: 10,
        currency: "USD",
        documents: [doc("a", 100), doc("b", 100, 0), doc("c", 400, 40)],
      });

      expect(summary(result)).toEqual([["c", 10, 0]]);
    });

    it("venta: no deja un centimo de Bs incobrable al cubrir un documento", () => {
      // 10 USD a 36.501 = Bs 365,01. Saldo Bs 365,02 → quedaria Bs 0,01.
      const result = allocatePayment({
        amount: 20,
        currency: "USD",
        documents: [doc("a", 365.02, 36.501)],
        minPayableVes: MIN_PAYABLE_VES_BY_DOCUMENT.sale,
      });

      expect(result.allocations[0].amount).toBe(9.99);
      expect(result.allocations[0].remainingVes).toBeGreaterThanOrEqual(0.02);
    });
  });

  describe("invariantes", () => {
    const rates = [36.5, 41.2375, 97.1234, 148.9, 201.0001];

    it.each(["USD", "VES"] as const)(
      "%s: las partes suman el monto aplicado y ningun saldo queda negativo ni incobrable",
      (currency) => {
        let seed = 7;
        const next = () => {
          seed = (seed * 1103515245 + 12345) % 2147483648;
          return seed / 2147483648;
        };

        for (let round = 0; round < 300; round += 1) {
          const documents = Array.from({ length: 1 + Math.floor(next() * 5) }, (_, index) =>
            doc(`d${index}`, Math.round(next() * 500000) / 100, rates[Math.floor(next() * 5)]),
          );
          const amount = Math.round(next() * 2000000) / 100;
          const minPayableVes = round % 2 === 0 ? 0.02 : 0.01;
          const result = allocatePayment({ amount, currency, documents, minPayableVes });
          const partsCents = result.allocations.reduce(
            (sum, allocation) => sum + cents(allocation.amount),
            0,
          );

          expect(partsCents).toBe(cents(result.appliedAmount));
          expect(cents(result.appliedAmount) + cents(result.leftover)).toBe(cents(amount));

          for (const allocation of result.allocations) {
            const remaining = cents(allocation.remainingVes);

            expect(allocation.amount).toBeGreaterThan(0);
            expect(remaining).toBeGreaterThanOrEqual(0);
            expect(remaining === 0 || remaining >= cents(minPayableVes)).toBe(true);
            expect(cents(allocation.appliedVes) + remaining).toBe(
              cents(allocation.document.pendingVes),
            );
          }
        }
      },
    );
  });
});

describe("maxAllocatableAmount", () => {
  it("en Bs es la suma de los saldos", () => {
    expect(
      maxAllocatableAmount({ currency: "VES", documents: [doc("a", 100), doc("b", 250.5)] }),
    ).toBe(350.5);
  });

  it("en USD suma lo que cabe en cada documento a su tasa", () => {
    const documents = [doc("a", 100, 36.5), doc("b", 400, 40)];
    const max = maxAllocatableAmount({ currency: "USD", documents });

    expect(max).toBe(12.73);
    expect(allocatePayment({ amount: max, currency: "USD", documents }).leftover).toBe(0);
  });

  it("es cero sin documentos", () => {
    expect(maxAllocatableAmount({ currency: "VES", documents: [] })).toBe(0);
  });
});
