/**
 * @jest-environment node
 */

import { createPayment } from "@/modules/payments/services/payments.mock-server";
import { mockPayments, mockSales } from "@/shared/mocks/erp-data";

import { GET, POST } from "./route";

// El servicio simulado sigue siendo el real; solo se observa si la ruta lo llama.
jest.mock("../../../modules/payments/services/payments.mock-server", () => {
  const actual = jest.requireActual("../../../modules/payments/services/payments.mock-server");

  return { ...actual, createPayment: jest.fn(actual.createPayment) };
});

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

  describe("clave de idempotencia (P4-3)", () => {
    const KEY_REPLAY = "6f1a2b3c-4d5e-4f60-8a71-92b3c4d5e6f7";
    const KEY_CONFLICT = "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";

    function postPayment(body: Record<string, unknown>) {
      return POST(
        new Request("http://localhost/api/payments", {
          body: JSON.stringify(body),
          headers: {
            "content-type": "application/json",
            "x-demo-role": "contador",
          },
          method: "POST",
        }),
      );
    }

    function salePaidVes(saleId: string) {
      return mockSales.find((sale) => sale.id === saleId)?.paidVes;
    }

    it("un reintento con la misma clave responde 201 con el mismo pago y no vuelve a abonar la venta", async () => {
      const payload = {
        amount: 100,
        clientRequestId: KEY_REPLAY,
        method: "punto_venta",
        saleId: "sale-002",
      };
      const before = salePaidVes("sale-002") ?? 0;

      const first = await postPayment(payload);
      const firstBody = await first.json();
      const afterFirst = salePaidVes("sale-002");
      const retry = await postPayment(payload);
      const retryBody = await retry.json();

      expect(first.status).toBe(201);
      expect(retry.status).toBe(201);
      expect(retryBody.data).toEqual(firstBody.data);
      expect(afterFirst).toBe(before + 100);
      expect(salePaidVes("sale-002")).toBe(before + 100);
    });

    it("la misma clave con otro contenido responde 409 y no abona nada", async () => {
      const first = await postPayment({
        amount: 50,
        clientRequestId: KEY_CONFLICT,
        method: "punto_venta",
        saleId: "sale-002",
      });
      const afterFirst = salePaidVes("sale-002");
      const other = await postPayment({
        amount: 75,
        clientRequestId: KEY_CONFLICT,
        method: "punto_venta",
        saleId: "sale-002",
      });
      const body = await other.json();

      expect(first.status).toBe(201);
      expect(other.status).toBe(409);
      expect(body.error.code).toBe("CONFLICT");
      expect(salePaidVes("sale-002")).toBe(afterFirst);
    });

    it("sin clave cada envio registra su pago (comportamiento de siempre)", async () => {
      const payload = { amount: 10, method: "punto_venta", saleId: "sale-002" };
      const before = salePaidVes("sale-002") ?? 0;

      const first = await postPayment(payload);
      const second = await postPayment(payload);

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(salePaidVes("sale-002")).toBe(before + 20);
    });

    it("rechaza con 400 una clave que no es uuid", async () => {
      const before = salePaidVes("sale-002");
      const response = await postPayment({
        amount: 10,
        clientRequestId: "no-es-uuid",
        method: "punto_venta",
        saleId: "sale-002",
      });

      expect(response.status).toBe(400);
      expect(salePaidVes("sale-002")).toBe(before);
    });
  });

  describe("PAG-F5: cuerpos que no son un pago valido", () => {
    beforeEach(() => {
      jest.mocked(createPayment).mockClear();
    });

    function postRaw(body: string | undefined) {
      return POST(
        new Request("http://localhost/api/payments", {
          body,
          headers: {
            "content-type": "application/json",
            "x-demo-role": "contador",
          },
          method: "POST",
        }),
      );
    }

    it.each([
      ["vacio", undefined],
      ["JSON roto", '{"saleId":"sale-002",'],
      ["amount NaN", '{"saleId":"sale-002","method":"punto_venta","amount":NaN}'],
      ["amount Infinity", '{"saleId":"sale-002","method":"punto_venta","amount":Infinity}'],
      ["amount 1e999", '{"saleId":"sale-002","method":"punto_venta","amount":1e999}'],
    ])("cuerpo %s responde 400 BAD_REQUEST y no registra nada", async (_label, raw) => {
      const before = mockPayments.length;
      const response = await postRaw(raw);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error.code).toBe("BAD_REQUEST");
      expect(createPayment).not.toHaveBeenCalled();
      expect(mockPayments).toHaveLength(before);
    });

    it.each(["notes", "referenceCode", "bankName", "phone"])(
      "un caracter NUL en %s responde 400 en espanol sin llegar al servicio",
      async (field) => {
        const response = await postRaw(
          JSON.stringify({
            amount: 1,
            bankName: "Banco Nacional",
            method: "transferencia",
            purchaseId: "purchase-001",
            referenceCode: "TRX-1",
            [field]: "\u0000nulo",
          }),
        );
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.error.code).toBe("BAD_REQUEST");
        expect(JSON.stringify(body)).not.toMatch(/unicode/i);
        expect(body.error.issues).toEqual([
          expect.objectContaining({
            message: "El texto contiene caracteres no permitidos.",
            path: [field],
          }),
        ]);
        expect(createPayment).not.toHaveBeenCalled();
      },
    );

    it("unas notas de 2 MB responden 400 sin llegar al servicio", async () => {
      const response = await postRaw(
        JSON.stringify({
          amount: 1,
          method: "punto_venta",
          notes: "x".repeat(2_000_000),
          saleId: "sale-002",
        }),
      );

      expect(response.status).toBe(400);
      expect(createPayment).not.toHaveBeenCalled();
    });
  });
});
