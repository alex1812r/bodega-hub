/**
 * @jest-environment node
 */

import { GET, POST } from "./route";

describe("/api/platform/stores", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("lists stores for a superadmin", async () => {
    const response = await GET(
      new Request("http://localhost/api/platform/stores", {
        headers: { "x-demo-role": "superadmin" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ data: expect.objectContaining({ items: expect.any(Array) }) }),
    );
  });

  it("creates a store and its admin in mock mode", async () => {
    const response = await POST(
      new Request("http://localhost/api/platform/stores", {
        body: JSON.stringify({
          admin: {
            email: "nueva-admin@example.com",
            fullName: "Nueva Administradora",
            password: "password-seguro",
          },
          name: "Nueva Tienda",
          slug: `nueva-tienda-${Date.now()}`,
        }),
        headers: { "content-type": "application/json", "x-demo-role": "superadmin" },
        method: "POST",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data).toEqual(expect.objectContaining({
      name: "Nueva Tienda",
      users: [expect.objectContaining({ email: "nueva-admin@example.com", role: "admin" })],
    }));
  });
});
