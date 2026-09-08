import {
  commissionForSale,
  ownerBreakdown,
  reversalEntry,
  semaphoreLevel,
  shareOfGrossProfit,
  sumItem,
  sumPeriod,
  type PayrollCommissionEntry,
} from "./payrollMath";

function sale(saleTotalRef: number, commissionPct: number, kind: "late" | "normal" = "normal") {
  return {
    commissionRef: commissionForSale(saleTotalRef, commissionPct),
    kind,
    saleTotalRef,
  } satisfies PayrollCommissionEntry;
}

describe("commissionForSale", () => {
  it("aplica el porcentaje y redondea a dos decimales", () => {
    expect(commissionForSale(100, 3)).toBe(3);
    expect(commissionForSale(33.33, 3)).toBe(1);
    expect(commissionForSale(10.05, 3.5)).toBe(0.35);
  });

  it("maneja porcentajes con decimales", () => {
    expect(commissionForSale(1234.56, 4.25)).toBe(52.47);
  });

  it("no pierde el centavo en ventas mínimas", () => {
    expect(commissionForSale(0.01, 3)).toBe(0);
    expect(commissionForSale(0.34, 3)).toBe(0.01);
  });

  it("recorta porcentajes fuera de rango y valores no numéricos", () => {
    expect(commissionForSale(100, -5)).toBe(0);
    expect(commissionForSale(100, 150)).toBe(100);
    expect(commissionForSale(Number.NaN, 3)).toBe(0);
    expect(commissionForSale(100, Number.NaN)).toBe(0);
  });
});

describe("sumItem", () => {
  it("suma ventas comisionables y cuenta solo las que comisionan", () => {
    const totals = sumItem([sale(1000, 3), sale(500, 3), sale(250.5, 3, "late")]);

    expect(totals.salesCount).toBe(3);
    expect(totals.salesRef).toBe(1750.5);
    expect(totals.commissionRef).toBe(52.52);
    expect(totals.reversalRef).toBe(0);
    expect(totals.totalRef).toBe(52.52);
  });

  it("redondea por venta, no sobre la suma", () => {
    // 3 ventas de 10.05 al 3.5 % = 0.35 cada una (0.35175 truncado por venta).
    const totals = sumItem([sale(10.05, 3.5), sale(10.05, 3.5), sale(10.05, 3.5)]);

    expect(totals.commissionRef).toBe(1.05);
  });

  it("resta los reversos", () => {
    const totals = sumItem([sale(1000, 3), reversalEntry(200, 6)]);

    expect(totals.commissionRef).toBe(30);
    expect(totals.reversalRef).toBe(-6);
    expect(totals.totalRef).toBe(24);
  });

  it("nunca deja el total por debajo de cero", () => {
    const totals = sumItem([sale(100, 3), reversalEntry(5000, 150)]);

    expect(totals.commissionRef).toBe(3);
    expect(totals.reversalRef).toBe(-150);
    expect(totals.totalRef).toBe(0);
  });

  it("un cajero sin ventas devuelve todo en cero", () => {
    expect(sumItem([])).toEqual({
      commissionRef: 0,
      reversalRef: 0,
      salesCount: 0,
      salesRef: 0,
      totalRef: 0,
    });
  });

  it("la venta cobrada tarde cuenta igual que una normal", () => {
    const late = sumItem([sale(1000, 3, "late")]);
    const normal = sumItem([sale(1000, 3)]);

    expect(late.totalRef).toBe(normal.totalRef);
    expect(late.salesCount).toBe(1);
  });
});

describe("sumPeriod", () => {
  it("agrega los totales de varios cajeros", () => {
    const first = sumItem([sale(1000, 3)]);
    const second = sumItem([sale(500, 4), reversalEntry(100, 4)]);

    expect(sumPeriod([first, second])).toEqual({
      commissionRef: 50,
      reversalRef: -4,
      salesCount: 2,
      salesRef: 1500,
      totalRef: 46,
    });
  });

  it("suma los totales ya truncados en cero, no los negativos", () => {
    const drowned = sumItem([sale(100, 3), reversalEntry(5000, 150)]);
    const healthy = sumItem([sale(1000, 3)]);

    expect(sumPeriod([drowned, healthy]).totalRef).toBe(30);
  });
});

describe("shareOfGrossProfit", () => {
  it("calcula el porcentaje del margen que se va en comisiones", () => {
    expect(shareOfGrossProfit(30, 100)).toBe(30);
    expect(shareOfGrossProfit(12.5, 80)).toBe(15.63);
  });

  it("sin ganancia bruta no divide por cero", () => {
    expect(shareOfGrossProfit(30, 0)).toBeNull();
    expect(shareOfGrossProfit(30, null)).toBeNull();
    expect(shareOfGrossProfit(30, -100)).toBeNull();
    expect(shareOfGrossProfit(30, Number.NaN)).toBeNull();
  });
});

describe("semaphoreLevel", () => {
  it("usa las bandas por defecto con el umbral de 40 %", () => {
    expect(semaphoreLevel(10, 40)).toBe("verde");
    expect(semaphoreLevel(24.99, 40)).toBe("verde");
    expect(semaphoreLevel(25, 40)).toBe("ambar");
    expect(semaphoreLevel(40, 40)).toBe("ambar");
    expect(semaphoreLevel(40.01, 40)).toBe("rojo");
  });

  it("sin porcentaje informa que no hay datos", () => {
    expect(semaphoreLevel(null, 40)).toBe("sin-datos");
  });

  it("con un umbral bajo desaparece la banda ámbar", () => {
    expect(semaphoreLevel(9, 10)).toBe("verde");
    expect(semaphoreLevel(10, 10)).toBe("ambar");
    expect(semaphoreLevel(11, 10)).toBe("rojo");
  });
});

describe("ownerBreakdown", () => {
  it("reparte lo que queda después de comisiones", () => {
    expect(ownerBreakdown(1000, 200, 45, 20)).toEqual({
      afterCommissionRef: 800,
      freeRef: 280,
      reinvestRef: 360,
      reserveRef: 160,
    });
  });

  it("no reparte nada cuando las comisiones se comen el margen", () => {
    expect(ownerBreakdown(100, 300, 45, 20)).toEqual({
      afterCommissionRef: -200,
      freeRef: 0,
      reinvestRef: 0,
      reserveRef: 0,
    });
  });

  it("sin ganancia bruta no hay desglose", () => {
    expect(ownerBreakdown(null, 200, 45, 20)).toBeNull();
  });
});
