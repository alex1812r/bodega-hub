/**
 * @jest-environment node
 */

import * as payroll from "@/modules/payroll/services/payroll.mock-server";
import {
  currentPeriodKey,
  parsePeriodKey,
  previousPeriodKey,
} from "@/modules/payroll/utils/quincena";
import { mockSales, type SaleMock } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { POST } from "./route";

const PERIOD_KEY = previousPeriodKey(currentPeriodKey()) ?? "";
const RANGE = parsePeriodKey(PERIOD_KEY);
// Sin las ventas de demo de nomina: cada test siembra las suyas y afirma montos exactos.
const ORIGINAL_SALES = mockSales.filter((sale) => !sale.id.startsWith("sale-payroll-"));

function seedSale() {
  mockSales.length = 0;
  mockSales.push(...ORIGINAL_SALES, {
    createdAt: `${RANGE?.fromDate ?? ""}T14:00:00.000Z`,
    customerId: "cont-customer",
    discountRef: 0,
    id: "sale-payroll-approve",
    invoiceNumber: "V-PAYROLL-3",
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
}

function post(role: string, id: string) {
  return POST(
    new Request(`http://localhost/api/payroll/periods/${id}/approve`, {
      headers: { "x-demo-role": role },
      method: "POST",
    }),
    { params: Promise.resolve({ id }) },
  );
}

describe("/api/payroll/periods/[id]/approve", () => {
  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    payroll.__resetPayrollMockState();
    seedSale();
  });

  afterEach(() => {
    mockSales.length = 0;
    mockSales.push(...ORIGINAL_SALES);
  });

  it("approves a draft and consumes its sales", async () => {
    payroll.upsertPayrollEmployee("user-seller", { commissionPct: 5 }, DEFAULT_STORE_ID);
    const period = payroll.createPayrollPeriod({ periodKey: PERIOD_KEY }, DEFAULT_STORE_ID);

    const response = await post("admin", period.id);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("aprobado");
    expect(body.data.approvedAt).not.toBeNull();

    const detail = payroll.getPayrollPeriodDetail(period.id, DEFAULT_STORE_ID);

    expect(detail.salesByItem[detail.items[0].id]).toHaveLength(1);
  });

  it("returns 400 when nobody has a commission configured", async () => {
    const period = payroll.createPayrollPeriod({ periodKey: PERIOD_KEY }, DEFAULT_STORE_ID);
    const response = await post("admin", period.id);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.message).toMatch(/no hay empleados/i);
  });

  it("returns 409 when the fortnight was already approved", async () => {
    payroll.upsertPayrollEmployee("user-seller", { commissionPct: 5 }, DEFAULT_STORE_ID);
    const period = payroll.createPayrollPeriod({ periodKey: PERIOD_KEY }, DEFAULT_STORE_ID);
    payroll.approvePayrollPeriod(period.id, DEFAULT_STORE_ID);

    const response = await post("admin", period.id);

    expect(response.status).toBe(409);
  });

  it("blocks sellers", async () => {
    payroll.upsertPayrollEmployee("user-seller", { commissionPct: 5 }, DEFAULT_STORE_ID);
    const period = payroll.createPayrollPeriod({ periodKey: PERIOD_KEY }, DEFAULT_STORE_ID);

    const response = await post("vendedor", period.id);

    expect(response.status).toBe(403);
  });
});
