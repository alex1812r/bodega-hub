/**
 * @jest-environment node
 */
/**
 * STK-511 · C6 (lado BFF): `create_purchase` recibe la clave de idempotencia y el
 * BFF degrada sin 500 si la base aun no tiene la firma con `p_client_request_id`.
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../lib/supabase/admin-client");

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { createPurchase } from "./purchases.server";

const CLIENT_REQUEST_ID = "6f1a2b3c-4d5e-4f60-8a71-92b3c4d5e6f7";

const purchaseRow = {
  created_at: "2026-05-17T16:00:00.000Z",
  discount_ref: 0,
  id: "11111111-1111-1111-1111-111111111111",
  paid_ves: 0,
  purchase_number: "C-000001",
  ref_rate_ves: 510,
  status: "recibido" as const,
  subtotal_ref: 4,
  supplier_id: "22222222-2222-2222-2222-222222222222",
  tax_ref: 0,
  total_ref: 4,
  total_ves: 2040,
  updated_at: "2026-05-17T16:00:00.000Z",
  user_id: "33333333-3333-3333-3333-333333333333",
};

const input = {
  discountRef: 0,
  discountVes: 0,
  items: [
    {
      costCurrency: "ref" as const,
      entryMode: "unit" as const,
      productId: "44444444-4444-4444-4444-444444444444",
      quantity: 2,
      subtotalRef: 4,
      subtotalVes: 2040,
      taxRate: 0,
      taxRef: 0,
      taxVes: 0,
      unitCostRef: 2,
      unitCostVes: 1020,
    },
  ],
  refRateVes: 510,
  status: "recibido" as const,
  subtotalRef: 4,
  subtotalVes: 2040,
  supplierId: purchaseRow.supplier_id,
  taxRef: 0,
  taxVes: 0,
};

const missingSignatureError = {
  code: "PGRST202",
  message: "Could not find the function public.create_purchase(p_client_request_id, …) in the schema cache",
};

function mountRpc(rpc: jest.Mock) {
  (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ rpc });
}

describe("purchases.server · clave de idempotencia (C6)", () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("pasa la clave a create_purchase como p_client_request_id", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: purchaseRow, error: null });
    mountRpc(rpc);

    await createPurchase({ ...input, clientRequestId: CLIENT_REQUEST_ID }, DEFAULT_STORE_ID);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]?.[0]).toBe("create_purchase");
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_client_request_id: CLIENT_REQUEST_ID,
      p_supplier_id: purchaseRow.supplier_id,
    });
  });

  it("sin clave no envia p_client_request_id", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: purchaseRow, error: null });
    mountRpc(rpc);

    await createPurchase(input, DEFAULT_STORE_ID);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(Object.keys(rpc.mock.calls[0]?.[1] as object)).not.toContain("p_client_request_id");
  });

  it("si la firma no acepta la clave (PGRST202) reintenta una vez sin ella y lo deja en el log", async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ data: null, error: missingSignatureError })
      .mockResolvedValueOnce({ data: purchaseRow, error: null });
    mountRpc(rpc);

    const result = await createPurchase(
      { ...input, clientRequestId: CLIENT_REQUEST_ID },
      DEFAULT_STORE_ID,
    );

    expect(result.purchaseNumber).toBe("C-000001");
    expect(rpc).toHaveBeenCalledTimes(2);

    const [firstArgs, secondArgs] = rpc.mock.calls.map(
      ([, args]) => args as Record<string, unknown>,
    );
    const { p_client_request_id: sentKey, ...firstWithoutKey } = firstArgs ?? {};

    expect(sentKey).toBe(CLIENT_REQUEST_ID);
    expect(secondArgs).toEqual(firstWithoutKey);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("create_purchase");
  });

  it("si el reintento sin clave tambien falla, propaga ese error sin un tercer intento", async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ data: null, error: missingSignatureError })
      .mockResolvedValueOnce({ data: null, error: missingSignatureError });
    mountRpc(rpc);

    await expect(
      createPurchase({ ...input, clientRequestId: CLIENT_REQUEST_ID }, DEFAULT_STORE_ID),
    ).rejects.toBeDefined();
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
