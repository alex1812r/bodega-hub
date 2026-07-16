/**
 * @jest-environment node
 */

import { GET } from "./route";

describe("/api/platform/users/[id]", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("returns user detail for a superadmin", async () => {
    const response = await GET(
      new Request("http://localhost/api/platform/users/user-admin", {
        headers: { "x-demo-role": "superadmin" },
      }),
      { params: Promise.resolve({ id: "user-admin" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual(
      expect.objectContaining({
        email: "admin@example.com",
        id: "user-admin",
        role: "admin",
        store: expect.objectContaining({ slug: "default" }),
      }),
    );
  });

  it("hides superadmin profiles", async () => {
    const response = await GET(
      new Request("http://localhost/api/platform/users/66666666-6666-4666-8666-666666666666", {
        headers: { "x-demo-role": "superadmin" },
      }),
      { params: Promise.resolve({ id: "66666666-6666-4666-8666-666666666666" }) },
    );

    expect(response.status).toBe(404);
  });
});
