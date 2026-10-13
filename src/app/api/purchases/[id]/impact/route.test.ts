/**
 * @jest-environment node
 */

import {
  mockPayments,
  mockProducts,
  mockPurchases,
  mockStockMovements,
} from "@/shared/mocks/erp-data";

import { GET } from "./route";

const context = (id: string) => ({
  params: Promise.resolve({ id }),
});

function get(id: string, query: string, headers: Record<string, string> = { "x-demo-role": "admin" }) {
  return GET(new Request(`http://localhost/api/purchases/${id}/impact${query}`, { headers }), context(id));
}

const list = (value: unknown) => `&disassemble=${encodeURIComponent(JSON.stringify(value))}`;

describe("/api/purchases/[id]/impact", () => {
  it("devuelve el efecto de recibir el pedido, sin caché", async () => {
    const response = await get("purchase-002", "?action=receive");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.data).toEqual(
      expect.objectContaining({
        action: "receive",
        allowed: true,
        blockingProducts: [],
        disassemble: [],
        document: {
          contactName: expect.any(String),
          id: "purchase-002",
          number: "C-000002",
          status: "pedido",
          statusAfter: "recibido",
        },
        inexact: null,
        payments: [],
        reason: null,
        reasonCode: null,
      }),
    );
    expect(body.data.stock).toEqual([
      expect.objectContaining({ productId: "prod-hammer", purchasedIn: 8, quantityDelta: 8, stockAfter: 8, stockBefore: 0 }),
      expect.objectContaining({ productId: "prod-pipe", quantityDelta: 5, stockAfter: 17, stockBefore: 12 }),
      expect.objectContaining({ productId: "prod-switch", quantityDelta: 2, stockAfter: 32, stockBefore: 30 }),
    ]);
    expect(body.data.costs).toEqual([
      expect.objectContaining({ costRefAfter: 3.25, costRefBefore: 3.25, productId: "prod-hammer", source: "purchase_line" }),
      expect.objectContaining({ costRefAfter: 4.8, productId: "prod-pipe" }),
      expect.objectContaining({ costRefAfter: 1.2, productId: "prod-switch" }),
    ]);
  });

  it("cancelar con un pago activo: allowed=false con el motivo de la RPC y el pago que bloquea", async () => {
    const response = await get("purchase-001", "?action=cancel");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual(
      expect.objectContaining({
        action: "cancel",
        allowed: false,
        paymentsRestricted: false,
        reason:
          "La compra C-000001 tiene 1 pago(s) activo(s) por Bs 10200.00. Anula primero los pagos y luego cancela la compra.",
        reasonCode: "CONFLICT",
      }),
    );
    expect(body.data.document.statusAfter).toBe("recibido");
    expect(body.data.payments).toEqual([
      expect.objectContaining({ method: "transferencia", outcome: "blocks_action", paymentId: "pay-003" }),
    ]);
  });

  it("almacén (sin permiso de pagos de compras): mismo veredicto, sin líneas de pago", async () => {
    const response = await get("purchase-001", "?action=return", { "x-demo-role": "almacen" });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual(
      expect.objectContaining({ allowed: false, payments: [], paymentsRestricted: true, reasonCode: "CONFLICT" }),
    );
    expect(JSON.stringify(body.data)).not.toContain("pay-003");
  });

  it("recibir con la lista disassemble: se valida con el esquema del PATCH y manda sobre las marcas", async () => {
    const empty = await get("purchase-002", `?action=receive${list([])}`);

    expect(empty.status).toBe(200);
    expect((await empty.json()).data.allowed).toBe(true);

    const foreign = await get("purchase-002", `?action=receive${list([{ purchaseItemId: "otra" }])}`);
    const body = await foreign.json();

    expect(foreign.status).toBe(200);
    expect(body.data).toEqual(
      expect.objectContaining({
        allowed: false,
        reason: "Una linea a desarmar no pertenece a la compra",
        reasonCode: "BAD_REQUEST",
      }),
    );
  });

  it.each([
    "?action=receive&disassemble=no-json",
    `?action=receive${list({ purchaseItemId: "x" })}`,
    `?action=receive${list([{ purchaseItemId: "" }])}`,
    `?action=receive${list([{ distribution: [{ unitProductId: "u", units: -1 }], purchaseItemId: "x" }])}`,
    `?action=receive${list([])}${list([])}`,
    `?action=cancel${list([])}`,
  ])("400 con disassemble mal formado, repetido o fuera de receive (%s)", async (query) => {
    const response = await get("purchase-002", query);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("BAD_REQUEST");
  });

  it.each(["", "?action=", "?action=delete", "?action=cancel&action=return", "?accion=cancel"])(
    "400 con action ausente o inválida (%s)",
    async (query) => {
      const response = await get("purchase-002", query);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error.code).toBe("BAD_REQUEST");
    },
  );

  it("403 para un rol que no puede recibir, cancelar ni devolver compras", async () => {
    for (const role of ["vendedor", "contador"]) {
      for (const action of ["receive", "cancel", "return"]) {
        const response = await get("purchase-002", `?action=${action}`, { "x-demo-role": role });

        expect(response.status).toBe(403);
      }
    }
  });

  it("404 si la compra no existe", async () => {
    const response = await get("missing", "?action=cancel");

    expect(response.status).toBe(404);
  });

  it("404 si la compra es de otra tienda", async () => {
    for (const action of ["receive", "cancel", "return"]) {
      const response = await get("purchase-002", `?action=${action}`, {
        "x-demo-role": "admin",
        "x-demo-store-id": "00000000-0000-4000-8000-000000000002",
      });
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error.code).toBe("NOT_FOUND");
    }
  });

  it("no tiene efectos: el mock queda igual tras pedir el impact", async () => {
    const state = () => JSON.stringify([mockPurchases, mockPayments, mockProducts, mockStockMovements]);
    const before = state();

    await get("purchase-002", "?action=receive");
    await get("purchase-001", "?action=cancel");
    await get("purchase-001", "?action=return");

    expect(state()).toBe(before);
  });
});
