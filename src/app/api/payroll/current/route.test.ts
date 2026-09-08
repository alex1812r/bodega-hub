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

const CURRENT_KEY = currentPeriodKey();
const PREVIOUS_KEY = previousPeriodKey(CURRENT_KEY) ?? "";
const RANGE = parsePeriodKey(CURRENT_KEY);
const ORIGINAL_SALES = [...mockSales];

function seedCurrentSale() {
  payroll.__resetPayrollMockState();
  mockSales.length = 0;
  mockSales.push(...ORIGINAL_SALES, {
    createdAt: `${RANGE?.fromDate ?? ""}T14:00:00.000Z`,
    customerId: "cont-customer",
    discountRef: 0,
    id: "sale-payroll-current",
    invoiceNumber: "V-PAYROLL-8",
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
}

function get(role: string) {
  return GET(
    new Request("http://localhost/api/payroll/current", { headers: { "x-demo-role": role } }),
  );
}

describe("/api/payroll/current", () => {
  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    seedCurrentSale();
  });

  afterEach(() => {
    mockSales.length = 0;
    mockSales.push(...ORIGINAL_SALES);
  });

  it("returns the running estimate and the previous fortnight key", async () => {
    const response = await get("admin");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.currentPeriodKey).toBe(CURRENT_KEY);
    expect(body.data.previousPeriodKey).toBe(PREVIOUS_KEY);
    expect(body.data.previousPeriod).toBeNull();
    expect(body.data.estimate).toEqual([
      expect.objectContaining({ profileId: "user-seller", salesRef: 100, totalRef: 5 }),
    ]);
    expect(body.data.estimateTotalRef).toBe(5);
  });

  it("returns the previous fortnight once it was computed", async () => {
    payroll.createPayrollPeriod({ periodKey: PREVIOUS_KEY }, DEFAULT_STORE_ID);

    const response = await get("admin");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.previousPeriod).toMatchObject({
      periodKey: PREVIOUS_KEY,
      status: "borrador",
    });
  });

  it("blocks sellers", async () => {
    const response = await get("vendedor");

    expect(response.status).toBe(403);
  });
});
