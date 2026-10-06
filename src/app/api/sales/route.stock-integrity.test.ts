/**
 * @jest-environment node
 */
/**
 * STK-413 · regresión de C5(a) (POST /api/sales sin clave de idempotencia) y del
 * caso de C12 que vive en la ruta (cuerpo JSON inválido → 500).
 *
 * Nacieron como `it.failing` (STK-413) y pasaron a `it` con el arreglo de STK-507.
 */

jest.mock("../../../lib/supabase/route-client", () => ({
  createRouteSupabaseClient: jest.fn(),
}));

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import { POST } from "./route";

type RpcArgs = Record<string, unknown> | undefined;

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCT_ID = "44444444-4444-4444-8444-444444444444";
const CLIENT_REQUEST_ID = "6f1a2b3c-4d5e-4f60-8a71-92b3c4d5e6f7";

function postSale(body: string) {
  return POST(
    new Request("http://localhost/api/sales", {
      body,
      headers: { "content-type": "application/json", "x-demo-role": "vendedor" },
      method: "POST",
    }),
  );
}

/** RPC de creación de venta: cada llamada devuelve una venta NUEVA, como la base real sin clave. */
function mountSalesRpc() {
  let sequence = 0;
  const rpc = jest.fn<Promise<{ data: unknown; error: null }>, [string, RpcArgs?]>(async () => {
    sequence += 1;

    return {
      data: {
        created_at: "2026-10-06T07:17:37.000Z",
        customer_id: CUSTOMER_ID,
        discount_ref: 0,
        exchange_rate_id: null,
        id: `22222222-2222-4222-8222-00000000000${sequence}`,
        invoice_number: `V-2026100607173796${sequence}`,
        notes: null,
        paid_ves: 0,
        ref_rate_ves: 510,
        status: "pendiente_pago",
        subtotal_ref: 15,
        tax_ref: 0,
        total_ref: 15,
        total_ves: 7650,
        updated_at: "2026-10-06T07:17:37.000Z",
        user_id: "33333333-3333-4333-8333-333333333333",
      },
      error: null,
    };
  });

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ rpc });

  /**
   * Ventas distintas que la base llegaría a crear: cada llamada de creación sin
   * clave es una venta nueva; las que llevan clave se deduplican por clave.
   */
  function distinctSaleCreations() {
    const keys = rpc.mock.calls
      .filter(([name]) => name === "create_sale" || name === "create_sale_with_payments")
      .map(([name, args]) => {
        const key = name === "create_sale_with_payments" ? args?.p_client_request_id : null;
        return typeof key === "string" && key ? key : null;
      });

    return keys.filter((key) => key === null).length + new Set(keys.filter((key) => key !== null)).size;
  }

  return { distinctSaleCreations, rpc };
}

describe("C5 · POST /api/sales sin clave de idempotencia", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.API_DATA_SOURCE = "supabase";
  });

  afterEach(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  // Causa: `clientRequestId` es opcional en el schema y, sin clave ni cobros,
  // `createSale` usa `create_sale` (sin idempotencia): 2 POST = 2 ventas con stock
  // descontado dos veces. Con cobros y sin clave llega `p_client_request_id: null`.
  // Evento: caos/9.1.md (`9.1.no_key_x2`: 201+201, 60 ventas / stock 16 en vez de 18, 30/30).
  // Código: src/app/api/sales/route.ts:21 (`.optional()`) y
  // src/modules/sales/services/sales.server.ts:396-408 (`atomic`).
  it.each([
    [
      "sin cobros (create_sale)",
      { customerId: CUSTOMER_ID, items: [{ productId: PRODUCT_ID, quantity: 2 }], refRateVes: 510 },
    ],
    [
      "con cobros y sin clave (create_sale_with_payments con clave nula)",
      {
        customerId: CUSTOMER_ID,
        items: [{ productId: PRODUCT_ID, quantity: 2 }],
        payments: [{ amount: 15, currency: "USD", method: "efectivo_usd" }],
        refRateVes: 510,
      },
    ],
  ])("dos POST idénticos sin clientRequestId no crean dos ventas: %s", async (_caso, payload) => {
    const sales = mountSalesRpc();
    const body = JSON.stringify(payload);

    const first = await postSale(body);
    const second = await postSale(body);

    // Sano si la ruta rechaza la petición (400) o si garantiza la idempotencia por
    // otro medio (misma clave derivada en ambas llamadas): nunca dos creaciones.
    expect({
      distinctSaleCreations: sales.distinctSaleCreations(),
      serverErrors: [first.status, second.status].filter((status) => status >= 500),
    }).toEqual({ distinctSaleCreations: expect.any(Number), serverErrors: [] });
    expect(sales.distinctSaleCreations()).toBeLessThanOrEqual(1);
  });

  // La ruta rechaza con 400 antes de tocar la base: sin clave no hay creacion.
  it("responde 400 y no llama a la base si falta clientRequestId", async () => {
    const sales = mountSalesRpc();

    const response = await postSale(
      JSON.stringify({
        customerId: CUSTOMER_ID,
        items: [{ productId: PRODUCT_ID, quantity: 2 }],
        refRateVes: 510,
      }),
    );
    const payload = (await response.json()) as { error?: { issues?: unknown } };

    expect(response.status).toBe(400);
    expect(JSON.stringify(payload.error?.issues)).toContain("clientRequestId");
    expect(sales.rpc).not.toHaveBeenCalled();
  });

  // Sin cobros tambien va por el RPC atomico (con `p_payments = []`) y con la clave.
  it("una venta sin cobros usa create_sale_with_payments con la clave y p_payments vacio", async () => {
    const sales = mountSalesRpc();

    const response = await postSale(
      JSON.stringify({
        clientRequestId: CLIENT_REQUEST_ID,
        customerId: CUSTOMER_ID,
        items: [{ productId: PRODUCT_ID, quantity: 2 }],
        refRateVes: 510,
      }),
    );

    expect(response.status).toBe(201);
    expect(sales.rpc.mock.calls.map(([name, args]) => [name, args?.p_client_request_id, args?.p_payments])).toEqual([
      ["create_sale_with_payments", CLIENT_REQUEST_ID, []],
    ]);
  });

  // Control (sano hoy): con la clave del POS las dos peticiones llegan al RPC
  // atómico con la MISMA clave; la base devuelve la venta ya registrada.
  it("dos POST idénticos con clientRequestId llegan al RPC con la misma clave", async () => {
    const sales = mountSalesRpc();
    const body = JSON.stringify({
      clientRequestId: CLIENT_REQUEST_ID,
      customerId: CUSTOMER_ID,
      items: [{ productId: PRODUCT_ID, quantity: 2 }],
      payments: [{ amount: 15, currency: "USD", method: "efectivo_usd" }],
      refRateVes: 510,
    });

    const first = await postSale(body);
    const second = await postSale(body);

    expect([first.status, second.status]).toEqual([201, 201]);
    expect(sales.rpc.mock.calls.map(([name, args]) => [name, args?.p_client_request_id])).toEqual([
      ["create_sale_with_payments", CLIENT_REQUEST_ID],
      ["create_sale_with_payments", CLIENT_REQUEST_ID],
    ]);
    expect(sales.distinctSaleCreations()).toBe(1);
  });
});

describe("C12 · POST /api/sales con cuerpo que no es JSON", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.API_DATA_SOURCE = "mock";
  });

  afterEach(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  // Causa: `request.json()` lanza `SyntaxError`, que no es `ApiError` ni `ZodError`
  // y cae al 500 genérico de `toErrorResponse`.
  // Evento: caos/propios.md N5 (JSON malformado o cuerpo vacío → `500 Ocurrio un error inesperado.`).
  // Código: src/app/api/sales/route.ts:66 y src/lib/api/apiError.ts:53-61.
  it.each([
    ["JSON malformado", '{"customerId": "cont-customer", "items": ['],
    ["cuerpo vacío", ""],
  ])("responde 400 y no 500: %s", async (_caso, body) => {
    const response = await postSale(body);
    const payload = (await response.json()) as { error?: { code?: string } };

    expect({ code: payload.error?.code, status: response.status }).toEqual({
      code: "BAD_REQUEST",
      status: 400,
    });
  });

  // Control (sano hoy): un JSON válido con forma inválida ya es 400.
  it("responde 400 a un JSON válido que no cumple el schema", async () => {
    const response = await postSale(JSON.stringify({ customerId: "cont-customer", items: [] }));

    expect(response.status).toBe(400);
  });
});
