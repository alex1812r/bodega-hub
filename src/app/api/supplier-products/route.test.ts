/**
 * @jest-environment node
 */

import { GET, POST } from "./route";

describe("/api/supplier-products", () => {
  it("returns supplier-product relations filtered by supplier", async () => {
    const response = await GET(
      new Request("http://localhost/api/supplier-products?supplierId=cont-supplier"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ supplierId: "cont-supplier" })]),
    );
  });

  it("filters active supplier products when isActive=true", async () => {
    const response = await GET(
      new Request("http://localhost/api/supplier-products?supplierId=cont-both&isActive=true"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items.every((item: { isActive?: boolean }) => item.isActive !== false)).toBe(
      true,
    );
  });

  it("returns enriched fields including lastCostVes and variationPercent", async () => {
    const response = await GET(
      new Request("http://localhost/api/supplier-products?supplierId=cont-both"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "supp-prod-drill",
          isActive: true,
          lastCostRef: 8.5,
          lastCostVes: 3102.5,
          lastPriceOrigin: "cotizacion",
          variationPercent: 6.25,
        }),
      ]),
    );
  });

  it("creates a simulated supplier-product relation with optional initial price", async () => {
    const response = await POST(
      new Request("http://localhost/api/supplier-products", {
        body: JSON.stringify({
          lastCostRef: 3,
          notes: "Cotizacion inicial",
          productId: "prod-paint",
          supplierId: "cont-supplier",
          supplierSku: "SUP-PAINT",
        }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "almacen",
        },
        method: "POST",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.productId).toBe("prod-paint");
    expect(body.data.lastCostRef).toBe(3);
    expect(body.data.lastPriceOrigin).toBe("vinculacion");
  });

  it("allows vendedor to list supplier products with products.view", async () => {
    const response = await GET(
      new Request("http://localhost/api/supplier-products?supplierId=cont-supplier", {
        headers: { "x-demo-role": "vendedor" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items.length).toBeGreaterThan(0);
  });

  it("blocks vendedor from creating supplier-product links", async () => {
    const response = await POST(
      new Request("http://localhost/api/supplier-products", {
        body: JSON.stringify({
          productId: "prod-paint",
          supplierId: "cont-supplier",
        }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "vendedor",
        },
        method: "POST",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("returns 409 when linking duplicate active supplier-product", async () => {
    const response = await POST(
      new Request("http://localhost/api/supplier-products", {
        body: JSON.stringify({
          productId: "prod-cable",
          supplierId: "cont-supplier",
          supplierSku: "SUP-CAB-DUP",
        }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "almacen",
        },
        method: "POST",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("CONFLICT");
  });

  it("reactivates an inactive supplier-product link on create", async () => {
    const response = await POST(
      new Request("http://localhost/api/supplier-products", {
        body: JSON.stringify({
          lastCostRef: 5.1,
          notes: "Relinked pipe",
          productId: "prod-pipe",
          supplierId: "cont-both",
          supplierSku: "DOB-PVC-012-NEW",
        }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "almacen",
        },
        method: "POST",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.id).toBe("supp-prod-pipe");
    expect(body.data.isActive).toBe(true);
    expect(body.data.supplierSku).toBe("dob-pvc-012-new");
    expect(body.data.lastCostRef).toBe(5.1);
    expect(body.data.lastPriceOrigin).toBe("vinculacion");
  });
});
