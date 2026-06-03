/**
 * @jest-environment node
 */

import { GET } from "./route";

describe("GET /api/products/import/template", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("returns an xlsx template with categories from mock data", async () => {
    const response = await GET(new Request("http://localhost/api/products/import/template"));
    const buffer = Buffer.from(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("spreadsheetml.sheet");
    expect(response.headers.get("content-disposition")).toContain("plantilla-productos.xlsx");
    expect(buffer.byteLength).toBeGreaterThan(100);
  });

  it("blocks template download for contador without products.view", async () => {
    const response = await GET(
      new Request("http://localhost/api/products/import/template", {
        headers: { "x-demo-role": "contador" },
      }),
    );

    expect(response.status).toBe(403);
  });
});
