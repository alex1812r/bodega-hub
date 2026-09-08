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

function seedFortnight() {
  payroll.__resetPayrollMockState();
  mockSales.length = 0;
  mockSales.push(...ORIGINAL_SALES, {
    createdAt: `${RANGE?.fromDate ?? ""}T14:00:00.000Z`,
    customerId: "cont-customer",
    discountRef: 0,
    id: "sale-payroll-recompute",
    invoiceNumber: "V-PAYROLL-2",
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

function post(role: string, id: string) {
  return POST(
    new Request(`http://localhost/api/payroll/periods/${id}/recompute`, {
      headers: { "x-demo-role": role },
      method: "POST",
    }),
    { params: Promise.resolve({ id }) },
  );
}

describe("/api/payroll/periods/[id]/recompute", () => {
  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
  });

  afterEach(() => {
    mockSales.length = 0;
    mockSales.push(...ORIGINAL_SALES);
  });

  it("recomputes a draft and drops a sale that was cancelled meanwhile", async () => {
    const period = seedFortnight();
    const sale = mockSales.find((row) => row.id === "sale-payroll-recompute");

    if (sale) {
      sale.status = "cancelada";
    }

    const response = await post("admin", period.id);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ commissionRef: 0, status: "borrador", totalRef: 0 });
  });

  it("refuses to recompute an approved fortnight", async () => {
    const period = seedFortnight();
    payroll.approvePayrollPeriod(period.id, DEFAULT_STORE_ID);

    const response = await post("admin", period.id);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("CONFLICT");
  });

  it("blocks sellers", async () => {
    const period = seedFortnight();
    const response = await post("vendedor", period.id);

    expect(response.status).toBe(403);
  });
});
