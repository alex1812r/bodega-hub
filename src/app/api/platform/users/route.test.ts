/**
 * @jest-environment node
 */

import { GET, POST } from "./route";

describe("/api/platform/users", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("lists store users for a superadmin", async () => {
    const response = await GET(
      new Request("http://localhost/api/platform/users", {
        headers: { "x-demo-role": "superadmin" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items.length).toBeGreaterThan(0);
    expect(body.data.items.every((user: { role: string }) => user.role !== "superadmin")).toBe(
      true,
    );
  });

  it("rejects store admin from listing platform users", async () => {
    const response = await GET(
      new Request("http://localhost/api/platform/users", {
        headers: { "x-demo-role": "admin" },
      }),
    );

    expect(response.status).toBe(403);
  });

  it("creates a store admin only", async () => {
    const response = await POST(
      new Request("http://localhost/api/platform/users", {
        body: JSON.stringify({
          email: `admin-${Date.now()}@example.com`,
          fullName: "Admin Extra",
          password: "password-seguro",
          storeId: "00000000-0000-4000-8000-000000000001",
        }),
        headers: { "content-type": "application/json", "x-demo-role": "superadmin" },
        method: "POST",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data).toEqual(
      expect.objectContaining({
        name: "Admin Extra",
        role: "admin",
        store: expect.objectContaining({ id: "00000000-0000-4000-8000-000000000001" }),
      }),
    );
  });
});
