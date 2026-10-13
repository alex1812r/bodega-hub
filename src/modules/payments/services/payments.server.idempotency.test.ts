/**
 * @jest-environment node
 */
/**
 * PAG-06a · P4-3 (lado BFF): `register_payment` recibe la clave de idempotencia
 * y el BFF degrada sin 500 si la base aun no tiene la firma con
 * `p_client_request_id` (parche 20261008a sin aplicar).
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../lib/supabase/admin-client");

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { createPayment } from "./payments.server";

const CLIENT_REQUEST_ID = "6f1a2b3c-4d5e-4f60-8a71-92b3c4d5e6f7";

const paymentRow = {
  amount: 1000,
  amount_ref: 1.96,
  amount_ves: 1000,
  bank_name: null,
  contact_id: "11111111-1111-1111-1111-111111111111",
  created_at: "2026-05-18T14:35:00.000Z",
  currency: "VES",
  direction: "entrada",
  id: "22222222-2222-2222-2222-222222222222",
  method: "punto_venta",
  notes: null,
  phone: null,
  purchase_id: null,
  reference_code: null,
  ref_rate_ves: 510,
  sale_id: "33333333-3333-3333-3333-333333333333",
};

const input = {
  amount: 1000,
  method: "punto_venta" as const,
  saleId: paymentRow.sale_id,
};

const missingSignatureError = {
  code: "PGRST202",
  message:
    "Could not find the function public.register_payment(p_amount, p_client_request_id, …) in the schema cache",
};

function mountRpc(rpc: jest.Mock) {
  const saleBuilder = {
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({
      data: { id: paymentRow.sale_id, invoice_number: "VEN-0128", paid_ves: 1000, total_ves: 7650 },
      error: null,
    }),
    select: jest.fn().mockReturnThis(),
  };

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
    from: jest.fn().mockReturnValue(saleBuilder),
    rpc,
  });
}

describe("payments.server · clave de idempotencia (P4-3)", () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("pasa la clave a register_payment como p_client_request_id", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: paymentRow, error: null });
    mountRpc(rpc);

    const result = await createPayment(
      { ...input, clientRequestId: CLIENT_REQUEST_ID },
      DEFAULT_STORE_ID,
    );

    expect(result.id).toBe(paymentRow.id);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]?.[0]).toBe("register_payment");
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_amount: 1000,
      p_client_request_id: CLIENT_REQUEST_ID,
      p_sale_id: paymentRow.sale_id,
    });
  });

  it("sin clave no envia p_client_request_id", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: paymentRow, error: null });
    mountRpc(rpc);

    await createPayment(input, DEFAULT_STORE_ID);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(Object.keys(rpc.mock.calls[0]?.[1] as object)).not.toContain("p_client_request_id");
  });

  it("un replay (la base devuelve el pago original) responde con ese mismo pago", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: paymentRow, error: null });
    mountRpc(rpc);

    const first = await createPayment(
      { ...input, clientRequestId: CLIENT_REQUEST_ID },
      DEFAULT_STORE_ID,
    );
    const retry = await createPayment(
      { ...input, clientRequestId: CLIENT_REQUEST_ID },
      DEFAULT_STORE_ID,
    );

    expect(retry).toEqual(first);
    expect(rpc.mock.calls[1]?.[1]).toEqual(rpc.mock.calls[0]?.[1]);
  });

  it("la misma clave con otro contenido (PT409) sale como 409 CONFLICT con el mensaje de la base", async () => {
    const message =
      "La clave de idempotencia ya se usó en otro pago. Revisa el pago registrado antes de reintentar.";
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { code: "PT409", message } });
    mountRpc(rpc);

    await expect(
      createPayment({ ...input, clientRequestId: CLIENT_REQUEST_ID }, DEFAULT_STORE_ID),
    ).rejects.toMatchObject({ code: "CONFLICT", message, status: 409 });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("si la firma no acepta la clave (PGRST202) reintenta una vez sin ella y lo deja en el log", async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ data: null, error: missingSignatureError })
      .mockResolvedValueOnce({ data: paymentRow, error: null });
    mountRpc(rpc);

    const result = await createPayment(
      { ...input, clientRequestId: CLIENT_REQUEST_ID },
      DEFAULT_STORE_ID,
    );

    expect(result.id).toBe(paymentRow.id);
    expect(rpc).toHaveBeenCalledTimes(2);

    const [firstArgs, secondArgs] = rpc.mock.calls.map(
      ([, args]) => args as Record<string, unknown>,
    );
    const { p_client_request_id: sentKey, ...firstWithoutKey } = firstArgs ?? {};

    expect(sentKey).toBe(CLIENT_REQUEST_ID);
    expect(secondArgs).toEqual(firstWithoutKey);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("register_payment");
  });

  it("si el reintento sin clave tambien falla, propaga ese error sin un tercer intento", async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ data: null, error: missingSignatureError })
      .mockResolvedValueOnce({ data: null, error: missingSignatureError });
    mountRpc(rpc);

    await expect(
      createPayment({ ...input, clientRequestId: CLIENT_REQUEST_ID }, DEFAULT_STORE_ID),
    ).rejects.toBeDefined();
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
