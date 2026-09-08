/**
 * @jest-environment node
 */

import { __resetPayrollMockState } from "@/modules/payroll/services/payroll.mock-server";

import { GET, PATCH } from "./route";

function request(role: string, init?: RequestInit) {
  return new Request("http://localhost/api/payroll/settings", {
    ...init,
    headers: { "content-type": "application/json", "x-demo-role": role },
  });
}

describe("/api/payroll/settings", () => {
  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    __resetPayrollMockState();
  });

  it("returns the defaults and the eligible cashiers for the admin", async () => {
    const response = await GET(request("admin"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.settings).toMatchObject({
      defaultCommissionPct: 3,
      eligibleRoles: ["vendedor"],
      warnShareOfGrossProfitPct: 40,
    });
    expect(body.data.employees.length).toBeGreaterThan(0);
    expect(body.data.employees.every((employee: { role: string }) => employee.role === "vendedor")).toBe(
      true,
    );
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

  it("updates the default commission", async () => {
    const response = await PATCH(
      request("admin", {
        body: JSON.stringify({ defaultCommissionPct: 4.5, warnShareOfGrossProfitPct: 30 }),
        method: "PATCH",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.settings.defaultCommissionPct).toBe(4.5);
    expect(body.data.settings.warnShareOfGrossProfitPct).toBe(30);
  });

  it("rejects a commission outside 0-100", async () => {
    const response = await PATCH(
      request("admin", {
        body: JSON.stringify({ defaultCommissionPct: 140 }),
        method: "PATCH",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("BAD_REQUEST");
  });
});
