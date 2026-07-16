/**
 * @jest-environment node
 */

import { GET, PATCH } from "./route";

const defaultStoreId = "00000000-0000-4000-8000-000000000001";

describe("/api/platform/stores/[id]", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("returns detail for a superadmin", async () => {
    const response = await GET(
      new Request(`http://localhost/api/platform/stores/${defaultStoreId}`, {
        headers: { "x-demo-role": "superadmin" },
      }),
      { params: Promise.resolve({ id: defaultStoreId }) },
    );
    expect(response.status).toBe(200);
  });

  it("updates store status for a superadmin", async () => {
    const response = await PATCH(
      new Request(`http://localhost/api/platform/stores/${defaultStoreId}`, {
        body: JSON.stringify({ status: "paused" }),
        headers: { "content-type": "application/json", "x-demo-role": "superadmin" },
        method: "PATCH",
      }),
      { params: Promise.resolve({ id: defaultStoreId }) },
    );
    expect(response.status).toBe(200);
  });
});
