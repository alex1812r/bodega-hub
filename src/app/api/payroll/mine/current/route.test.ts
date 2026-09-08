/**
 * @jest-environment node
 */

import * as payroll from "@/modules/payroll/services/payroll.mock-server";
import { currentPeriodKey, parsePeriodKey } from "@/modules/payroll/utils/quincena";
import { mockSales, type SaleMock } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { GET } from "./route";

const RANGE = parsePeriodKey(currentPeriodKey());
// Sin las ventas de demo de nomina: cada test siembra las suyas y afirma montos exactos.
const ORIGINAL_SALES = mockSales.filter((sale) => !sale.id.startsWith("sale-payroll-"));

/** Venta cobrada dentro de la quincena en curso: solo estimación, nada escrito. */
function seedCurrentSale() {
  payroll.__resetPayrollMockState();
  mockSales.length = 0;
  mockSales.push(...ORIGINAL_SALES, {
    createdAt: `${RANGE?.fromDate ?? ""}T14:00:00.000Z`,
    customerId: "cont-customer",
    discountRef: 0,
    id: "sale-payroll-mine-current",
    invoiceNumber: "V-PAYROLL-7",
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

function get(role: string, userId?: string) {
  const headers: Record<string, string> = { "x-demo-role": role };

  if (userId) {
    headers["x-demo-user-id"] = userId;
  }

  return GET(new Request("http://localhost/api/payroll/mine/current", { headers }));
}

describe("/api/payroll/mine/current", () => {
  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    seedCurrentSale();
  });

  afterEach(() => {
    mockSales.length = 0;
    mockSales.push(...ORIGINAL_SALES);
  });

  it("estimates the running commission of the cashier", async () => {
    const response = await get("vendedor", "user-seller");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.currentPeriodKey).toBe(currentPeriodKey());
    expect(body.data.estimate).toMatchObject({ salesRef: 100, totalRef: 5 });
  });

  it("returns no estimate for a cashier without sales", async () => {
    const response = await get("vendedor", "user-seller-cashier");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.estimate).toBeNull();
  });

  it("blocks the admin", async () => {
    const response = await get("admin");

    expect(response.status).toBe(403);
  });
});
