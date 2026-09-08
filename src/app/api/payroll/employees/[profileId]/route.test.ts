/**
 * @jest-environment node
 */

import { __resetPayrollMockState } from "@/modules/payroll/services/payroll.mock-server";

import { PUT } from "./route";

function request(role: string, profileId: string, body: unknown) {
  return {
    context: { params: Promise.resolve({ profileId }) },
    request: new Request(`http://localhost/api/payroll/employees/${profileId}`, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", "x-demo-role": role },
      method: "PUT",
    }),
  };
}

describe("/api/payroll/employees/[profileId]", () => {
  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    __resetPayrollMockState();
  });

  it("saves the commission of a cashier", async () => {
    const { context, request: input } = request("admin", "user-seller", { commissionPct: 4 });
    const response = await PUT(input, context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      commissionPct: 4,
      isActive: true,
      profileId: "user-seller",
      role: "vendedor",
    });
  });

  it("blocks sellers", async () => {
    const { context, request: input } = request("vendedor", "user-seller", { commissionPct: 4 });
    const response = await PUT(input, context);

    expect(response.status).toBe(403);
  });

  it("returns 404 for a profile of another store", async () => {
    const { context, request: input } = request("admin", "user-sur-admin", { commissionPct: 4 });
    const response = await PUT(input, context);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("rejects the admin as a payroll employee", async () => {
    const { context, request: input } = request("admin", "user-admin", { commissionPct: 4 });
    const response = await PUT(input, context);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.message).toMatch(/no cobra nómina/i);
  });
});
