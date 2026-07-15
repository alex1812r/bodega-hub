/**
 * @jest-environment node
 */

import { DELETE } from "./route";

describe("/api/products/[id]/image", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("clears imageUrl for authorized role", async () => {
    const { mockProducts } = await import("@/shared/mocks/erp-data");
    const product = mockProducts.find((item) => item.id === "prod-drill");

    if (product) {
      product.imageUrl = "https://example.supabase.co/storage/v1/object/public/product-images/prod-drill/cover.webp";
    }

    const response = await DELETE(new Request("http://localhost/api/products/prod-drill/image"), {
      params: Promise.resolve({ id: "prod-drill" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.imageUrl ?? null).toBeNull();
  });
});
