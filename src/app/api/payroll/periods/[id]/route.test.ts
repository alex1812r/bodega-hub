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

import { GET } from "./route";

const PERIOD_KEY = previousPeriodKey(currentPeriodKey()) ?? "";
const RANGE = parsePeriodKey(PERIOD_KEY);
// Sin las ventas de demo de nomina: cada test siembra las suyas y afirma montos exactos.
const ORIGINAL_SALES = mockSales.filter((sale) => !sale.id.startsWith("sale-payroll-"));

/** Quincena cerrada con una venta cobrada del cajero demo. */
function seedFortnight() {
  payroll.__resetPayrollMockState();
  mockSales.length = 0;
  mockSales.push(...ORIGINAL_SALES, {
    createdAt: `${RANGE?.fromDate ?? ""}T14:00:00.000Z`,
    customerId: "cont-customer",
    discountRef: 0,
    id: "sale-payroll-detail",
    invoiceNumber: "V-PAYROLL-1",
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

  return payroll.createPayrollPeriod({ periodKey: PERIOD_KEY }, DEFAULT_STORE_ID);
}

function get(role: string, id: string, userId?: string) {
  const headers: Record<string, string> = { "x-demo-role": role };

  if (userId) {
    headers["x-demo-user-id"] = userId;
  }

  return GET(new Request(`http://localhost/api/payroll/periods/${id}`, { headers }), {
    params: Promise.resolve({ id }),
  });
}

describe("/api/payroll/periods/[id]", () => {
  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
  });

  afterEach(() => {
    mockSales.length = 0;
    mockSales.push(...ORIGINAL_SALES);
  });

  it("returns the fortnight with its items and the owner breakdown", async () => {
    const period = seedFortnight();
    const response = await get("admin", period.id);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.period).toMatchObject({ commissionRef: 5, status: "borrador", totalRef: 5 });
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]).toMatchObject({ profileId: "user-seller", salesRef: 100 });
    expect(body.data.settings.defaultCommissionPct).toBe(3);
  });

  it("returns 404 for an unknown fortnight", async () => {
    seedFortnight();
    const response = await get("admin", "payroll-period-mock-999");

    expect(response.status).toBe(404);
  });

  it("hides the business figures from the cashier", async () => {
    const period = seedFortnight();
    payroll.approvePayrollPeriod(period.id, DEFAULT_STORE_ID);

    const response = await get("vendedor", period.id, "user-seller");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.breakdown).toBeNull();
    expect(body.data.salesWithoutCashier).toBe(0);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0].profileId).toBe("user-seller");
  });

  it("returns 404 to a cashier without an item in the fortnight", async () => {
    const period = seedFortnight();
    const response = await get("vendedor", period.id, "user-seller-cashier");

    expect(response.status).toBe(404);
  });
});
