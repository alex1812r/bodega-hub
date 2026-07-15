/**
 * @jest-environment node
 */

import { POST } from "./route";

describe("/api/products/[id]/image-upload-url", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("returns signed upload data for authorized role", async () => {
    const response = await POST(new Request("http://localhost/api/products/prod-drill/image-upload-url"), {
      params: Promise.resolve({ id: "prod-drill" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual(
      expect.objectContaining({
        path: "prod-drill/cover.webp",
        publicUrl: expect.stringContaining("prod-drill/cover.webp"),
        uploadUrl: expect.stringContaining("mock-upload.local"),
      }),
    );
  });

  it("returns 404 for unknown product", async () => {
    const response = await POST(
      new Request("http://localhost/api/products/missing/image-upload-url"),
      {
        params: Promise.resolve({ id: "missing" }),
      },
    );

    expect(response.status).toBe(404);
  });
});
