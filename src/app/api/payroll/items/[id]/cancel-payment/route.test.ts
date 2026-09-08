/**
 * @jest-environment node
 */

import * as payroll from "@/modules/payroll/services/payroll.mock-server";
import {
  currentPeriodKey,
  parsePeriodKey,
  previousPeriodKey,
} from "@/modules/payroll/utils/quincena";
import { getVault } from "@/modules/vault/services/vault.mock-server";
import { mockSales, type SaleMock } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { POST } from "./route";

const PERIOD_KEY = previousPeriodKey(currentPeriodKey()) ?? "";
const RANGE = parsePeriodKey(PERIOD_KEY);
// Sin las ventas de demo de nomina: cada test siembra las suyas y afirma montos exactos.
const ORIGINAL_SALES = mockSales.filter((sale) => !sale.id.startsWith("sale-payroll-"));

function seedApprovedFortnight() {
  payroll.__resetPayrollMockState();
  mockSales.length = 0;
  mockSales.push(...ORIGINAL_SALES, {
    createdAt: `${RANGE?.fromDate ?? ""}T14:00:00.000Z`,
    customerId: "cont-customer",
    discountRef: 0,
    id: "sale-payroll-cancel",
    invoiceNumber: "V-PAYROLL-5",
    paidVes: 51000,
    refRateVes: 510,
    status: "pagada",
    storeId: DEFAULT_STORE_ID,
    subtotalRef: 100,
    taxRef: 0,
    totalRef: 100,
    totalVes: 51000,
    userId: "user-seller",
  } satisfies SaleMock);
  payroll.upsertPayrollEmployee("user-seller", { commissionPct: 5 }, DEFAULT_STORE_ID);

  const period = payroll.createPayrollPeriod({ periodKey: PERIOD_KEY }, DEFAULT_STORE_ID);

  // Aprobar recalcula y regenera los ítems: el id definitivo se lee después.
  payroll.approvePayrollPeriod(period.id, DEFAULT_STORE_ID);

  const item = payroll.getPayrollPeriodDetail(period.id, DEFAULT_STORE_ID).items[0];

  return { itemId: item.id, periodId: period.id };
}

function post(role: string, id: string, body: unknown) {
  return POST(
    new Request(`http://localhost/api/payroll/items/${id}/cancel-payment`, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", "x-demo-role": role },
      method: "POST",
    }),
    { params: Promise.resolve({ id }) },
  );
}

describe("/api/payroll/items/[id]/cancel-payment", () => {
  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
  });

  afterEach(() => {
    mockSales.length = 0;
    mockSales.push(...ORIGINAL_SALES);
  });

  it("gives the money back to the vault and reopens the fortnight", async () => {
    const { itemId, periodId } = seedApprovedFortnight();
    const before = getVault(DEFAULT_STORE_ID).balanceEfectivoVes;

    payroll.payPayrollItem(itemId, { amount: 2550, method: "efectivo_ves" }, DEFAULT_STORE_ID);

    const response = await post("admin", itemId, { notes: "Se pagó dos veces" });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ paidVes: null, status: "pendiente", vaultMovementId: null });
    expect(getVault(DEFAULT_STORE_ID).balanceEfectivoVes).toBe(before);

    const detail = payroll.getPayrollPeriodDetail(periodId, DEFAULT_STORE_ID);

    expect(detail.period.status).toBe("aprobado");
    expect(detail.period.notes).toMatch(/Pago anulado/);
  });

  it("returns 409 when the receipt was never paid", async () => {
    const { itemId } = seedApprovedFortnight();

    const response = await post("admin", itemId, { notes: "Prueba" });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("CONFLICT");
  });

  it("requires a reason", async () => {
    const { itemId } = seedApprovedFortnight();
    payroll.payPayrollItem(itemId, { amount: 2550, method: "efectivo_ves" }, DEFAULT_STORE_ID);

    const response = await post("admin", itemId, { notes: "   " });

    expect(response.status).toBe(400);
  });

  it("blocks sellers", async () => {
    const { itemId } = seedApprovedFortnight();

    const response = await post("vendedor", itemId, { notes: "Prueba" });

    expect(response.status).toBe(403);
  });
});
