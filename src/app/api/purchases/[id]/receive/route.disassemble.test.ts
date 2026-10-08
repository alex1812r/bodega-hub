/**
 * @jest-environment node
 */
/**
 * COM-14 · `PATCH /api/purchases/{id}/receive` con «Desarmar al recibir» (modo
 * mock): cuerpo opcional, lista de líneas a desarmar, permisos y errores.
 */

import { createPurchase, getPurchaseById } from "@/modules/purchases/services/purchases.mock-server";
import { mockProducts } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { PATCH } from "./route";

// Semilla: "prod-cigar-pack" es el empaque de la receta activa de 10 "prod-cigar-unit".
const PACK = "prod-cigar-pack";
const UNIT = "prod-cigar-unit";

const context = (id: string) => ({ params: Promise.resolve({ id }) });

function stockOf(productId: string) {
  return mockProducts.find((product) => product.id === productId)?.currentStock;
}

/** Pedido de 2 empaques con la línea marcada (o no) «Desarmar al recibir». */
function order(marked: boolean) {
  const purchase = createPurchase(
    {
      discountRef: 0,
      items: [
        {
          costCurrency: "ref",
          ...(marked ? { disassembleOnReceive: true } : {}),
          entryMode: "unit",
          productId: PACK,
          quantity: 2,
          subtotalRef: 24,
          subtotalVes: 2400,
          taxRateCode: "exento",
          taxRef: 0,
          taxVes: 0,
          unitCostRef: 12,
          unitCostVes: 1200,
        },
      ],
      refRateVes: 100,
      status: "pedido",
      subtotalRef: 24,
      supplierId: "cont-supplier",
      taxRef: 0,
    },
    DEFAULT_STORE_ID,
  );

  return { id: purchase.id, itemId: getPurchaseById(purchase.id, DEFAULT_STORE_ID).items[0].id };
}

function receive(id: string, init: { body?: string; role?: string } = {}) {
  return PATCH(
    new Request(`http://localhost/api/purchases/${id}/receive`, {
      ...(init.body === undefined ? {} : { body: init.body }),
      headers: { "content-type": "application/json", "x-demo-role": init.role ?? "almacen" },
      method: "PATCH",
    }),
    context(id),
  );
}

describe("PATCH /api/purchases/[id]/receive · desarmar al recibir (COM-14)", () => {
  it("sin cuerpo: recibe y abre los empaques de la línea que el pedido guardó marcada", async () => {
    const { id } = order(true);
    const before = { pack: stockOf(PACK) ?? 0, unit: stockOf(UNIT) ?? 0 };

    const response = await receive(id);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      items: [{ disassembled: true, disassembleOnReceive: true }],
      status: "recibido",
    });
    expect({ pack: stockOf(PACK), unit: stockOf(UNIT) }).toEqual({ pack: before.pack, unit: before.unit + 20 });
  });

  it("disassemble: [] recibe sin desarmar aunque la línea estuviera marcada", async () => {
    const { id } = order(true);
    const before = stockOf(UNIT);

    const response = await receive(id, { body: JSON.stringify({ disassemble: [] }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items[0]).toMatchObject({ disassembled: false, disassembleOnReceive: false });
    expect(stockOf(UNIT)).toBe(before);
  });

  it("disassemble con la línea y su reparto: desarma una línea que el pedido no tenía marcada", async () => {
    const { id, itemId } = order(false);
    const before = stockOf(UNIT) ?? 0;

    const response = await receive(id, {
      body: JSON.stringify({
        clientRequestId: "6f1a2b3c-4d5e-4f60-8a71-92b3c4d5e6f7",
        disassemble: [{ distribution: [{ unitProductId: UNIT, units: 20 }], purchaseItemId: itemId }],
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items[0]).toMatchObject({ disassembled: true, disassembleOnReceive: true });
    expect(stockOf(UNIT)).toBe(before + 20);
  });

  it("reparto que no suma: 400 con el mensaje del servidor y la compra sigue en pedido", async () => {
    const { id, itemId } = order(true);

    const response = await receive(id, {
      body: JSON.stringify({
        disassemble: [{ distribution: [{ unitProductId: UNIT, units: 7 }], purchaseItemId: itemId }],
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.message).toBe("El reparto debe sumar 20 unidades (2 empaques × 10) y suma 7.");
    expect(getPurchaseById(id, DEFAULT_STORE_ID).status).toBe("pedido");
  });

  it.each([
    ["JSON roto", "{no"],
    ["lista que no es una lista", JSON.stringify({ disassemble: "todas" })],
    ["clave que no es uuid", JSON.stringify({ clientRequestId: "x" })],
  ])("cuerpo inválido (%s): 400 y no recibe", async (_title, raw) => {
    const { id } = order(true);

    const response = await receive(id, { body: raw });

    expect(response.status).toBe(400);
    expect(getPurchaseById(id, DEFAULT_STORE_ID).status).toBe("pedido");
  });

  it("un vendedor no puede recibir: 403 y la compra sigue en pedido", async () => {
    const { id } = order(true);

    const response = await receive(id, { role: "vendedor" });

    expect(response.status).toBe(403);
    expect(getPurchaseById(id, DEFAULT_STORE_ID).status).toBe("pedido");
  });
});
