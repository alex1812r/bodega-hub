/**
 * @jest-environment node
 */

import * as payroll from "@/modules/payroll/services/payroll.mock-server";
import {
  currentPeriodKey,
  parsePeriodKey,
  previousPeriodKey,
} from "@/modules/payroll/utils/quincena";
import { getVault, listVaultMovements } from "@/modules/vault/services/vault.mock-server";
import { mockSales, type SaleMock } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { POST } from "./route";

const PERIOD_KEY = previousPeriodKey(currentPeriodKey()) ?? "";
const RANGE = parsePeriodKey(PERIOD_KEY);
// Sin las ventas de demo de nomina: cada test siembra las suyas y afirma montos exactos.
const ORIGINAL_SALES = mockSales.filter((sale) => !sale.id.startsWith("sale-payroll-"));

/** Quincena aprobada con un recibo de 5 REF (100 REF vendidos al 5 %). */
function seedApprovedFortnight() {
  payroll.__resetPayrollMockState();
  mockSales.length = 0;
  mockSales.push(...ORIGINAL_SALES, {
    createdAt: `${RANGE?.fromDate ?? ""}T14:00:00.000Z`,
    customerId: "cont-customer",
    discountRef: 0,
    id: "sale-payroll-pay",
    invoiceNumber: "V-PAYROLL-4",
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

  return { itemId: item.id, period };
}

function post(role: string, id: string, body: unknown, userId?: string) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-demo-role": role,
  };

  if (userId) {
    headers["x-demo-user-id"] = userId;
  }

  return POST(
    new Request(`http://localhost/api/payroll/items/${id}/pay`, {
      body: JSON.stringify(body),
      headers,
      method: "POST",
    }),
    { params: Promise.resolve({ id }) },
  );
}

describe("/api/payroll/items/[id]/pay", () => {
  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
  });

  afterEach(() => {
    mockSales.length = 0;
    mockSales.push(...ORIGINAL_SALES);
  });

  it("pays from the vault and leaves a payroll_out movement", async () => {
    const { itemId } = seedApprovedFortnight();
    const before = getVault(DEFAULT_STORE_ID).balanceEfectivoVes;

    const response = await post("admin", itemId, { amount: 2550, method: "efectivo_ves" });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ paidCurrency: "VES", paidVes: 2550, status: "pagado" });
    expect(getVault(DEFAULT_STORE_ID).balanceEfectivoVes).toBe(before - 2550);
    expect(
      listVaultMovements(DEFAULT_STORE_ID).some(
        (movement) => movement.id === body.data.vaultMovementId && movement.type === "payroll_out",
      ),
    ).toBe(true);
  });

  it("returns 409 on a double payment", async () => {
    const { itemId } = seedApprovedFortnight();

    await post("admin", itemId, { amount: 2550, method: "efectivo_ves" });
    const response = await post("admin", itemId, { amount: 2550, method: "efectivo_ves" });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("CONFLICT");
  });

  it("returns 400 while the fortnight is still a draft", async () => {
    payroll.__resetPayrollMockState();
    mockSales.length = 0;
    mockSales.push(...ORIGINAL_SALES);
    payroll.upsertPayrollEmployee("user-seller", { commissionPct: 5 }, DEFAULT_STORE_ID);

    const period = payroll.createPayrollPeriod({ periodKey: PERIOD_KEY }, DEFAULT_STORE_ID);
    const item = payroll.getPayrollPeriodDetail(period.id, DEFAULT_STORE_ID).items[0];

    const response = await post("admin", item.id, { amount: 10, method: "efectivo_ves" });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.message).toMatch(/aprueba la quincena/i);
  });

  it("returns INSUFFICIENT_VAULT_BALANCE when the bucket does not cover the payment", async () => {
    const { itemId } = seedApprovedFortnight();

    // El baúl se queda sin efectivo: el monto es el correcto, lo que falta es el saldo.
    getVault(DEFAULT_STORE_ID).balanceEfectivoVes = 100;

    const response = await post("admin", itemId, { amount: 2550, method: "efectivo_ves" });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INSUFFICIENT_VAULT_BALANCE");
    expect(body.error.message).toMatch(/saldo insuficiente en el baul \(efectivo\)/i);
  });

  it("rejects an amount that is not the receipt total", async () => {
    const { itemId } = seedApprovedFortnight();

    const response = await post("admin", itemId, { amount: 9_999_999, method: "efectivo_ves" });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.message).toMatch(/no corresponde al recibo/i);
  });

  it("blocks a seller from paying their own receipt", async () => {
    const { itemId } = seedApprovedFortnight();

    const response = await post(
      "vendedor",
      itemId,
      { amount: 2550, method: "efectivo_ves" },
      "user-seller",
    );

    expect(response.status).toBe(403);
  });

  it("requires a reference for pago movil", async () => {
    const { itemId } = seedApprovedFortnight();

    const response = await post("admin", itemId, { amount: 2550, method: "pago_movil" });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.message).toMatch(/referencia/i);
  });
});
