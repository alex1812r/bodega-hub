/**
 * @jest-environment node
 */

import { __resetPayrollMockState } from "@/modules/payroll/services/payroll.mock-server";
import { currentPeriodKey, previousPeriodKey } from "@/modules/payroll/utils/quincena";

import { GET, POST } from "./route";

const CLOSED_PERIOD_KEY = previousPeriodKey(currentPeriodKey()) ?? "";

function request(role: string, init?: RequestInit) {
  return new Request("http://localhost/api/payroll/periods", {
    ...init,
    headers: { "content-type": "application/json", "x-demo-role": role },
  });
}

describe("/api/payroll/periods", () => {
  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    __resetPayrollMockState();
  });

  it("lists the fortnights of the store", async () => {
    const response = await GET(request("admin"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual([]);
    expect(body.data.total).toBe(0);
  });

  it("blocks sellers", async () => {
    const response = await GET(request("vendedor"));

    expect(response.status).toBe(403);
  });

  it("requires a session when demo auth is off", async () => {
    const original = process.env.ALLOW_DEMO_AUTH;
    process.env.ALLOW_DEMO_AUTH = "false";

    const response = await GET(request("admin"));

    process.env.ALLOW_DEMO_AUTH = original;

    expect(response.status).toBe(401);
  });

  it("computes a closed fortnight as a draft", async () => {
    const response = await POST(
      request("admin", {
        body: JSON.stringify({ periodKey: CLOSED_PERIOD_KEY }),
        method: "POST",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({ periodKey: CLOSED_PERIOD_KEY, status: "borrador" });
  });

  it("refuses the fortnight in progress", async () => {
    const response = await POST(
      request("admin", {
        body: JSON.stringify({ periodKey: currentPeriodKey() }),
        method: "POST",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.message).toMatch(/no ha terminado/i);
  });

  it("rejects a malformed fortnight key", async () => {
    const response = await POST(
      request("admin", { body: JSON.stringify({ periodKey: "2026-13-Q9" }), method: "POST" }),
    );

    expect(response.status).toBe(400);
  });
});
