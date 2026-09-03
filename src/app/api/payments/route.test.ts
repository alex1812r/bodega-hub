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
    // sale-002 ya recibe un abono en el test anterior de este suite
    expect(body.data.pendingBalanceVes).toBe(4925);
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

  it("hides purchase payments from vendedor", async () => {
    const response = await GET(
      new Request("http://localhost/api/payments", {
        headers: { "x-demo-role": "vendedor" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items.every((payment: { purchaseId?: string }) => !payment.purchaseId)).toBe(
      true,
    );
    expect(
      body.data.items.every((payment: { direction: string }) => payment.direction !== "salida"),
    ).toBe(true);
  });

  it("forbids vendedor from filtering purchase payments", async () => {
    const response = await GET(
      new Request("http://localhost/api/payments?purchaseId=purchase-001", {
        headers: { "x-demo-role": "vendedor" },
      }),
    );

    expect(response.status).toBe(403);
  });

  it("allows vendedor to register a sale payment", async () => {
    const response = await POST(
      new Request("http://localhost/api/payments", {
        body: JSON.stringify({
          amount: 500,
          method: "efectivo_ves",
          saleId: "sale-002",
        }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "vendedor",
        },
        method: "POST",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.direction).toBe("entrada");
    expect(body.data.saleId).toBe("sale-002");
  });

  it("forbids vendedor from registering a purchase payment", async () => {
    const response = await POST(
      new Request("http://localhost/api/payments", {
        body: JSON.stringify({
          amount: 500,
          method: "transferencia",
          bankName: "Banco Nacional",
          purchaseId: "purchase-001",
          referenceCode: "TRX-VENDEDOR",
        }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "vendedor",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
  });

  it("accepts a sale payment with change and counted bills", async () => {
    const response = await POST(
      new Request("http://localhost/api/payments", {
        body: JSON.stringify({
          amount: 3,
          change: { amount: 560, method: "efectivo_ves" },
          changeDenominations: { VES: { "200": 2, "100": 1, "50": 1, "10": 1 } },
          currency: "USD",
          method: "efectivo_usd",
          receivedDenominations: { USD: { "1": 3 } },
          saleId: "sale-002",
        }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "vendedor",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(201);
  });

  it("rejects change without a method", async () => {
    const response = await POST(
      new Request("http://localhost/api/payments", {
        body: JSON.stringify({
          amount: 3,
          change: { amount: 560 },
          currency: "USD",
          method: "efectivo_usd",
          saleId: "sale-002",
        }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "vendedor",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
  });

  it("rejects change on a purchase payment", async () => {
    const response = await POST(
      new Request("http://localhost/api/payments", {
        body: JSON.stringify({
          amount: 10,
          change: { amount: 5, method: "efectivo_ves" },
          currency: "USD",
          method: "efectivo_usd",
          purchaseId: "purchase-001",
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
