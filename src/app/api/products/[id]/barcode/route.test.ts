/**
 * @jest-environment node
 */

import { POST as createProduct } from "../../route";
import { POST } from "./route";

const context = (id: string) => ({
  params: Promise.resolve({ id }),
});

async function createProductWithoutBarcode() {
  const created = await createProduct(
    new Request("http://localhost/api/products", {
      body: JSON.stringify({
        name: "Producto sin barcode",
        salePriceRef: 1.5,
        sku: `SKU-BAR-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      }),
      headers: {
        "content-type": "application/json",
        "x-demo-role": "almacen",
      },
      method: "POST",
    }),
  );
  const body = await created.json();
  expect(created.status).toBe(201);
  return body.data.id as string;
}

describe("/api/products/[id]/barcode", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("allows vendedor to add barcode when product has none", async () => {
    const productId = await createProductWithoutBarcode();

    const response = await POST(
      new Request(`http://localhost/api/products/${productId}/barcode`, {
        body: JSON.stringify({ barcode: "7509999888777" }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "vendedor",
        },
        method: "POST",
      }),
      context(productId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.barcode).toBe("7509999888777");
  });

  it("rejects adding barcode when product already has one", async () => {
    const response = await POST(
      new Request("http://localhost/api/products/prod-drill/barcode", {
        body: JSON.stringify({ barcode: "7500000000999" }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "vendedor",
        },
        method: "POST",
      }),
      context("prod-drill"),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("BAD_REQUEST");
  });

  it("forbids contador without products.view", async () => {
    const productId = await createProductWithoutBarcode();

    const response = await POST(
      new Request(`http://localhost/api/products/${productId}/barcode`, {
        body: JSON.stringify({ barcode: "7500000000888" }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "contador",
        },
        method: "POST",
      }),
      context(productId),
    );

    expect(response.status).toBe(403);
  });
});
