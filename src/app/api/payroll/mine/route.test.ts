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

function seedApprovedFortnight() {
  payroll.__resetPayrollMockState();
  mockSales.length = 0;
  mockSales.push(...ORIGINAL_SALES, {
    createdAt: `${RANGE?.fromDate ?? ""}T14:00:00.000Z`,
    customerId: "cont-customer",
    discountRef: 0,
    id: "sale-payroll-mine",
    invoiceNumber: "V-PAYROLL-6",
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

  payroll.approvePayrollPeriod(period.id, DEFAULT_STORE_ID);
}

function get(role: string, userId?: string) {
  const headers: Record<string, string> = { "x-demo-role": role };

  if (userId) {
    headers["x-demo-user-id"] = userId;
  }

  return GET(new Request("http://localhost/api/payroll/mine", { headers }));
}

describe("/api/payroll/mine", () => {
  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    seedApprovedFortnight();
  });

  afterEach(() => {
    mockSales.length = 0;
    mockSales.push(...ORIGINAL_SALES);
  });

  it("lists the receipts of the signed-in cashier with their sales", async () => {
    const response = await get("vendedor", "user-seller");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0].item).toMatchObject({ profileId: "user-seller", totalRef: 5 });
    expect(body.data.items[0].period.periodKey).toBe(PERIOD_KEY);
    expect(body.data.items[0].sales).toHaveLength(1);
  });

  it("returns nothing for a cashier without receipts", async () => {
    const response = await get("vendedor", "user-seller-cashier");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual([]);
  });

  it("blocks the admin: the owner does not collect payroll", async () => {
    const response = await get("admin");

    expect(response.status).toBe(403);
  });

  it("requires a session when demo auth is off", async () => {
    const original = process.env.ALLOW_DEMO_AUTH;
    process.env.ALLOW_DEMO_AUTH = "false";

    const response = await get("vendedor", "user-seller");

    process.env.ALLOW_DEMO_AUTH = original;

    expect(response.status).toBe(401);
  });
});
