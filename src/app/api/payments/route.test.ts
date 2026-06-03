/**
 * @jest-environment node
 */

import { GET, POST } from "./route";

describe("/api/payments", () => {
  it("returns payments", async () => {
    const response = await GET(new Request("http://localhost/api/payments"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual(expect.any(Array));
  });

  it("creates a simulated payment with accountant role", async () => {
    const response = await POST(
      new Request("http://localhost/api/payments", {
        body: JSON.stringify({
          amount: 1000,
          method: "punto_venta",
          saleId: "sale-002",
        }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "contador",
        },
        method: "POST",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.direction).toBe("entrada");
  });

  it("filters payments by sale and contact", async () => {
    const response = await GET(
      new Request("http://localhost/api/payments?saleId=sale-001&contactId=cont-customer"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.total).toBe(1);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0].id).toBe("pay-001");
  });

  it("validates pago movil method requirements", async () => {
    const response = await POST(
      new Request("http://localhost/api/payments", {
        body: JSON.stringify({
          amount: 1000,
          method: "pago_movil",
          saleId: "sale-002",
        }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "contador",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
  });

  it("accepts transferencia with bank and reference", async () => {
    const response = await POST(
      new Request("http://localhost/api/payments", {
        body: JSON.stringify({
          amount: 1000,
          bankName: "Banco Nacional",
          method: "transferencia",
          purchaseId: "purchase-001",
          referenceCode: "TRX-999",
        }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "contador",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(201);
  });

  it("converts efectivo usd and returns pending balance", async () => {
    const response = await POST(
      new Request("http://localhost/api/payments", {
        body: JSON.stringify({
          amount: 5,
          currency: "USD",
          method: "efectivo_usd",
          saleId: "sale-002",
        }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "contador",
        },
        method: "POST",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.amountRef).toBe(5);
    expect(body.data.amountVes).toBe(2550);
    expect(body.data.pendingBalanceVes).toBe(5925);
  });

  it("accepts punto de venta without reference", async () => {
    const response = await POST(
      new Request("http://localhost/api/payments", {
        body: JSON.stringify({
          amount: 1000,
          method: "punto_venta",
          saleId: "sale-002",
        }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "contador",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(201);
  });

  it("validates sale or purchase association", async () => {
    const response = await POST(
      new Request("http://localhost/api/payments", {
        body: JSON.stringify({
          amount: 1000,
          method: "punto_venta",
        }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "contador",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
  });
});
