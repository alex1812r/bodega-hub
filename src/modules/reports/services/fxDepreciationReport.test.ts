import { computeFxDepreciationReport } from "./fxDepreciationReport";

describe("computeFxDepreciationReport", () => {
  it("values VES holdings at today's rate and keeps USD in REF", () => {
    const result = computeFxDepreciationReport({
      generatedAt: "2026-08-16T12:00:00.000Z",
      payments: [
        {
          amountRef: 10,
          amountVes: 7000,
          method: "pago_movil",
          saleId: "sale-1",
          storeId: "store-1",
        },
        {
          amountRef: 5,
          amountVes: 4000,
          method: "efectivo_usd",
          saleId: "sale-2",
          storeId: "store-1",
        },
      ],
      sales: [
        {
          createdAt: "2026-08-12T10:00:00.000Z",
          id: "sale-1",
          invoiceNumber: "V-1",
          refRateVes: 700,
          storeId: "store-1",
          totalRef: 10,
        },
        {
          createdAt: "2026-08-14T10:00:00.000Z",
          id: "sale-2",
          invoiceNumber: "V-2",
          refRateVes: 800,
          storeId: "store-1",
          totalRef: 5,
        },
      ],
      searchParams: new URLSearchParams(),
      valuationRatesByStore: {
        "store-1": { createdAt: "2026-08-16T00:00:00.000Z", rateVes: 800 },
      },
    });

    expect(result.summary.vesExposed).toBe(7000);
    expect(result.summary.vesRefAtCollection).toBe(10);
    expect(result.summary.vesRefToday).toBe(8.75);
    expect(result.summary.vesLossRef).toBe(1.25);
    expect(result.summary.usdHeldRef).toBe(5);
    expect(result.summary.capitalRefAtCollection).toBe(15);
    expect(result.summary.capitalRefToday).toBe(13.75);
    expect(result.summary.depreciationPctOnVes).toBe(12.5);
    expect(result.items).toHaveLength(2);
  });
});
