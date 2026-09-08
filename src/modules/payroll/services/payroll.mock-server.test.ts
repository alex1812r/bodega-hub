/**
 * @jest-environment node
 */

import { getVault, listVaultMovements } from "@/modules/vault/services/vault.mock-server";
import { mockSales, type SaleMock } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import {
  __resetPayrollMockState,
  approvePayrollPeriod,
  cancelPayrollPayment,
  createPayrollPeriod,
  getPayrollPeriodDetail,
  payPayrollItem,
  recomputePayrollPeriod,
  upsertPayrollEmployee,
} from "./payroll.mock-server";

/**
 * Semántica del cálculo, con el reloj congelado para que las quincenas de prueba
 * estén siempre cerradas: `2026-07-Q1` y `2026-07-Q2` quedan en el pasado.
 */

const CASHIER = "user-seller";
const PERIOD_A = "2026-07-Q1";
const PERIOD_B = "2026-07-Q2";
// Sin las ventas de demo de nomina: cada test siembra las suyas y afirma montos exactos.
const ORIGINAL_SALES = mockSales.filter((sale) => !sale.id.startsWith("sale-payroll-"));

function seedSale(sale: Partial<SaleMock> & Pick<SaleMock, "createdAt" | "id" | "totalRef">) {
  mockSales.push({
    customerId: "cont-customer",
    discountRef: 0,
    invoiceNumber: `V-${sale.id}`,
    paidVes: 0,
    refRateVes: 510,
    status: "pagada",
    storeId: DEFAULT_STORE_ID,
    subtotalRef: sale.totalRef,
    taxRef: 0,
    totalVes: sale.totalRef * 510,
    userId: CASHIER,
    ...sale,
  } as SaleMock);
}

function findSale(id: string) {
  const sale = mockSales.find((candidate) => candidate.id === id);

  if (!sale) {
    throw new Error(`Venta de prueba no encontrada: ${id}`);
  }

  return sale;
}

function cashierItem(periodId: string) {
  const detail = getPayrollPeriodDetail(periodId, DEFAULT_STORE_ID);
  const item = detail.items.find((row) => row.profileId === CASHIER);

  if (!item) {
    throw new Error("El cajero no tiene recibo en la quincena");
  }

  return { detail, item };
}

describe("payroll.mock-server", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-09-07T12:00:00.000Z"));
    __resetPayrollMockState();
    mockSales.length = 0;
    mockSales.push(...ORIGINAL_SALES);
    upsertPayrollEmployee(CASHIER, { commissionPct: 5 }, DEFAULT_STORE_ID);
  });

  afterEach(() => {
    jest.useRealTimers();
    mockSales.length = 0;
    mockSales.push(...ORIGINAL_SALES);
  });

  it("commissions a sale only once across two fortnights", () => {
    seedSale({ createdAt: "2026-07-05T14:00:00.000Z", id: "sale-q1", totalRef: 100 });

    const periodA = createPayrollPeriod({ periodKey: PERIOD_A }, DEFAULT_STORE_ID);

    expect(cashierItem(periodA.id).item).toMatchObject({
      commissionRef: 5,
      salesCount: 1,
      salesRef: 100,
      totalRef: 5,
    });

    approvePayrollPeriod(periodA.id, DEFAULT_STORE_ID);

    const periodB = createPayrollPeriod({ periodKey: PERIOD_B }, DEFAULT_STORE_ID);

    // La venta ya está consumida: la segunda quincena no la vuelve a pagar.
    expect(cashierItem(periodB.id).item).toMatchObject({
      commissionRef: 0,
      salesCount: 0,
      salesRef: 0,
      totalRef: 0,
    });
  });

  it("carries a late sale into the fortnight computed after it is paid", () => {
    seedSale({ createdAt: "2026-07-05T14:00:00.000Z", id: "sale-q1", totalRef: 100 });
    seedSale({
      createdAt: "2026-07-08T14:00:00.000Z",
      id: "sale-late",
      status: "pendiente_pago",
      totalRef: 50,
    });

    const periodA = createPayrollPeriod({ periodKey: PERIOD_A }, DEFAULT_STORE_ID);

    // Pendiente de cobro: no comisiona todavía.
    expect(cashierItem(periodA.id).item.salesCount).toBe(1);
    approvePayrollPeriod(periodA.id, DEFAULT_STORE_ID);

    findSale("sale-late").status = "pagada";
    seedSale({ createdAt: "2026-07-20T14:00:00.000Z", id: "sale-q2", totalRef: 200 });

    const periodB = createPayrollPeriod({ periodKey: PERIOD_B }, DEFAULT_STORE_ID);
    const { detail, item } = cashierItem(periodB.id);

    expect(item).toMatchObject({ salesCount: 2, salesRef: 250, totalRef: 12.5 });
    // Un borrador todavía no consume ventas: `payroll_commission_sales` se llena al aprobar.
    expect(detail.salesByItem[item.id]).toEqual([]);

    approvePayrollPeriod(periodB.id, DEFAULT_STORE_ID);

    const approved = cashierItem(periodB.id);

    expect(
      approved.detail.salesByItem[approved.item.id]
        .map((sale) => `${sale.saleId}:${sale.kind}`)
        .sort(),
    ).toEqual(["sale-late:late", "sale-q2:normal"]);
  });

  it("reverses a commissioned sale that gets cancelled, never below zero", () => {
    seedSale({ createdAt: "2026-07-05T14:00:00.000Z", id: "sale-q1", totalRef: 100 });

    const periodA = createPayrollPeriod({ periodKey: PERIOD_A }, DEFAULT_STORE_ID);
    approvePayrollPeriod(periodA.id, DEFAULT_STORE_ID);

    findSale("sale-q1").status = "cancelada";

    const periodB = createPayrollPeriod({ periodKey: PERIOD_B }, DEFAULT_STORE_ID);
    const { item } = cashierItem(periodB.id);

    expect(item.reversalRef).toBe(-5);
    expect(item.commissionRef).toBe(0);
    // Los reversos superan lo devengado: el ítem queda en cero, nunca negativo.
    expect(item.totalRef).toBe(0);
  });

  it("keeps the commission_pct snapshot after approving", () => {
    seedSale({ createdAt: "2026-07-05T14:00:00.000Z", id: "sale-q1", totalRef: 100 });

    const periodA = createPayrollPeriod({ periodKey: PERIOD_A }, DEFAULT_STORE_ID);
    approvePayrollPeriod(periodA.id, DEFAULT_STORE_ID);

    upsertPayrollEmployee(CASHIER, { commissionPct: 10 }, DEFAULT_STORE_ID);

    expect(cashierItem(periodA.id).item).toMatchObject({ commissionPct: 5, commissionRef: 5 });
  });

  it("freezes a paid fortnight", () => {
    seedSale({ createdAt: "2026-07-05T14:00:00.000Z", id: "sale-q1", totalRef: 100 });

    const periodA = createPayrollPeriod({ periodKey: PERIOD_A }, DEFAULT_STORE_ID);
    approvePayrollPeriod(periodA.id, DEFAULT_STORE_ID);

    const { item } = cashierItem(periodA.id);

    payPayrollItem(item.id, { amount: 2550, method: "efectivo_ves" }, DEFAULT_STORE_ID);

    expect(getPayrollPeriodDetail(periodA.id, DEFAULT_STORE_ID).period.status).toBe("pagado");
    expect(() => recomputePayrollPeriod(periodA.id, DEFAULT_STORE_ID)).toThrow(
      /no se puede recalcular/i,
    );
  });

  it("debits the vault with a payroll_out movement and restores it when cancelled", () => {
    seedSale({ createdAt: "2026-07-05T14:00:00.000Z", id: "sale-q1", totalRef: 100 });

    const periodA = createPayrollPeriod({ periodKey: PERIOD_A }, DEFAULT_STORE_ID);
    approvePayrollPeriod(periodA.id, DEFAULT_STORE_ID);

    const { item } = cashierItem(periodA.id);
    const before = getVault(DEFAULT_STORE_ID).balanceEfectivoVes;

    const paid = payPayrollItem(
      item.id,
      { amount: 2550, method: "efectivo_ves" },
      DEFAULT_STORE_ID,
    );

    expect(paid.status).toBe("pagado");
    expect(paid.paidVes).toBe(2550);
    expect(paid.paidRateVes).toBe(510);
    expect(paid.paidRef).toBe(5);
    expect(getVault(DEFAULT_STORE_ID).balanceEfectivoVes).toBe(before - 2550);

    const movement = listVaultMovements(DEFAULT_STORE_ID).find(
      (row) => row.id === paid.vaultMovementId,
    );

    expect(movement).toMatchObject({ amountVes: 2550, bucket: "efectivo", type: "payroll_out" });

    cancelPayrollPayment(item.id, { notes: "Pago duplicado" }, DEFAULT_STORE_ID);

    expect(getVault(DEFAULT_STORE_ID).balanceEfectivoVes).toBe(before);
    expect(
      listVaultMovements(DEFAULT_STORE_ID).some((row) => row.id === paid.vaultMovementId),
    ).toBe(false);
    expect(getPayrollPeriodDetail(periodA.id, DEFAULT_STORE_ID).period.status).toBe("aprobado");
  });

  it("rejects a payment that does not fit in the vault bucket", () => {
    seedSale({ createdAt: "2026-07-05T14:00:00.000Z", id: "sale-q1", totalRef: 100 });

    const periodA = createPayrollPeriod({ periodKey: PERIOD_A }, DEFAULT_STORE_ID);
    approvePayrollPeriod(periodA.id, DEFAULT_STORE_ID);

    const { item } = cashierItem(periodA.id);

    expect(() =>
      payPayrollItem(item.id, { amount: 9_999_999, method: "efectivo_ves" }, DEFAULT_STORE_ID),
    ).toThrow(/saldo insuficiente en el baul \(efectivo\)/i);
  });

  it("refuses to compute a fortnight that has not closed yet", () => {
    expect(() => createPayrollPeriod({ periodKey: "2026-09-Q1" }, DEFAULT_STORE_ID)).toThrow(
      /no ha terminado/i,
    );
  });
});
