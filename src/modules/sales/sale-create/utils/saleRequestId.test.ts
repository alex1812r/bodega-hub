import { z } from "zod";

import { canonicalSaleRequestContent, deriveSaleRequestId } from "./saleRequestId";

const CART_ID = "5f0c2a3e-8a61-4c0e-9f43-0c9f1f4d2b11";
const CONTENT = {
  customerId: "cont-1",
  items: [
    { productId: "prod-harina", quantity: 2 },
    { productId: "prod-azucar", quantity: 1 },
  ],
};

// La misma validación que aplica `POST /api/sales` a `clientRequestId`.
const bffClientRequestId = z.string().uuid();

describe("POS-H6 · clave de cobro derivada del carrito", () => {
  it("es determinista: mismo carrito y contenido, misma clave", () => {
    expect(deriveSaleRequestId(CART_ID, CONTENT)).toBe(
      deriveSaleRequestId(CART_ID, {
        customerId: "cont-1",
        items: CONTENT.items.map((item) => ({ ...item })),
      }),
    );
  });

  it("no depende del orden de las líneas", () => {
    expect(deriveSaleRequestId(CART_ID, { ...CONTENT, items: [...CONTENT.items].reverse() })).toBe(
      deriveSaleRequestId(CART_ID, CONTENT),
    );
  });

  it("cambia con cada campo: carrito, cliente, producto y cantidad", () => {
    const base = deriveSaleRequestId(CART_ID, CONTENT);
    const variants = [
      deriveSaleRequestId("5f0c2a3e-8a61-4c0e-9f43-0c9f1f4d2b12", CONTENT),
      deriveSaleRequestId(CART_ID, { ...CONTENT, customerId: "cont-2" }),
      deriveSaleRequestId(CART_ID, {
        ...CONTENT,
        items: [CONTENT.items[0], { productId: "prod-arroz", quantity: 1 }],
      }),
      deriveSaleRequestId(CART_ID, {
        ...CONTENT,
        items: [CONTENT.items[0], { productId: "prod-azucar", quantity: 2 }],
      }),
      deriveSaleRequestId(CART_ID, { ...CONTENT, items: [CONTENT.items[0]] }),
    ];

    expect(new Set([base, ...variants]).size).toBe(variants.length + 1);
  });

  it("no confunde cantidades entre líneas ni campos pegados", () => {
    // 2+1 no es 1+2, y el límite entre cliente y producto no se puede desplazar.
    expect(
      deriveSaleRequestId(CART_ID, {
        customerId: "cont-1",
        items: [
          { productId: "prod-harina", quantity: 1 },
          { productId: "prod-azucar", quantity: 2 },
        ],
      }),
    ).not.toBe(deriveSaleRequestId(CART_ID, CONTENT));
    expect(canonicalSaleRequestContent("a", { customerId: "bc", items: [] })).not.toBe(
      canonicalSaleRequestContent("ab", { customerId: "c", items: [] }),
    );
  });

  it("ignora lo que no identifica al carrito (datos del cobro que viajen en el mismo objeto)", () => {
    const withPayments = { ...CONTENT, payments: [{ amount: 5, method: "efectivo_usd" }] };

    expect(deriveSaleRequestId(CART_ID, withPayments)).toBe(deriveSaleRequestId(CART_ID, CONTENT));
  });

  it("tiene el formato que valida el BFF (UUID v8, variante estándar), también en muchos carritos", () => {
    const keys = new Set<string>();

    for (let index = 0; index < 2000; index += 1) {
      const key = deriveSaleRequestId(`cart-${index}`, {
        customerId: "cont-1",
        items: [{ productId: "prod-harina", quantity: (index % 7) + 1 }],
      });

      expect(bffClientRequestId.safeParse(key).success).toBe(true);
      expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      keys.add(key);
    }

    expect(keys.size).toBe(2000);
  });
});
