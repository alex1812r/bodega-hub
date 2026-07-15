/**
 * @jest-environment node
 */

import { GET } from "./route";

const context = (id: string) => ({
  params: Promise.resolve({ id }),
});

describe("/api/suppliers/[id]/products", () => {
  it("returns products for a supplier", async () => {
    const response = await GET(
      new Request("http://localhost/api/suppliers/cont-supplier/products"),
      context("cont-supplier"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual(expect.arrayContaining([expect.objectContaining({ productId: "prod-cable" })]),
    );
  });

  it("filters to active catalog entries for purchase flows", async () => {
    const response = await GET(
      new Request("http://localhost/api/suppliers/cont-both/products?isActive=true"),
      context("cont-both"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "supp-prod-drill", isActive: true })]),
    );
    expect(body.data.items.some((item: { id: string }) => item.id === "supp-prod-pipe")).toBe(false);
  });

  it("sorts linked products by unit cost ascending in mock mode", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/suppliers/cont-supplier/products?sortBy=lastCostRef&sortOrder=asc&limit=100",
      ),
      context("cont-supplier"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items.length).toBeGreaterThan(1);

    for (let index = 0; index < body.data.items.length - 1; index += 1) {
      expect(body.data.items[index].lastCostRef ?? 0).toBeLessThanOrEqual(
        body.data.items[index + 1].lastCostRef ?? 0,
      );
    }
  });

  it("searches linked products by product name, sku or supplier sku", async () => {
    const byName = await GET(
      new Request("http://localhost/api/suppliers/cont-supplier/products?search=Cable"),
      context("cont-supplier"),
    );
    const bySku = await GET(
      new Request("http://localhost/api/suppliers/cont-supplier/products?search=ELE-CAB-012"),
      context("cont-supplier"),
    );
    const bySupplierSku = await GET(
      new Request("http://localhost/api/suppliers/cont-supplier/products?search=SUP-CAB-12"),
      context("cont-supplier"),
    );

    expect(byName.status).toBe(200);
    expect(bySku.status).toBe(200);
    expect(bySupplierSku.status).toBe(200);

    for (const body of [await byName.json(), await bySku.json(), await bySupplierSku.json()]) {
      expect(body.data.items).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "supp-prod-cable" })]),
      );
    }
  });
});
