/**
 * @jest-environment node
 */
/**
 * STK-511 · C6 (lado BFF): `adjust_stock` y `convert_pack_to_units` reciben la
 * clave de idempotencia, y el BFF degrada sin 500 si la base aun no tiene la
 * firma con `p_client_request_id` (PGRST202).
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../lib/supabase/admin-client");

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { convertPackToUnits, createStockAdjustment } from "./inventory.server";

const CLIENT_REQUEST_ID = "6f1a2b3c-4d5e-4f60-8a71-92b3c4d5e6f7";
const PRODUCT_ID = "22222222-2222-4222-8222-222222222222";

const movementRow = {
  created_at: "2026-05-18T10:00:00.000Z",
  id: "11111111-1111-4111-8111-111111111111",
  product_id: PRODUCT_ID,
  quantity_delta: 3,
  reason: "Conteo fisico",
  stock_after: 21,
  type: "ajuste_entrada" as const,
};

const conversionPayload = {
  conversionId: "33333333-3333-4333-8333-333333333333",
  packMovement: { ...movementRow, quantity_delta: -1, type: "conversion_salida" as const },
  packQuantity: 1,
  unitCostRef: 1.25,
  unitMovement: { ...movementRow, quantity_delta: 10, type: "conversion_entrada" as const },
  unitQuantity: 10,
  unitsPerPack: 10,
};

const missingSignatureError = {
  code: "PGRST202",
  message:
    "Could not find the function public.adjust_stock(p_client_request_id, p_product_id, p_quantity_delta, p_reason, p_type) in the schema cache",
};

const adjustArgs = {
  p_product_id: PRODUCT_ID,
  p_quantity_delta: 3,
  p_reason: "Conteo fisico",
  p_type: "ajuste_entrada",
};

const convertArgs = {
  p_pack_product_id: PRODUCT_ID,
  p_pack_quantity: 1,
  p_reason: null,
};

function mountRpc(rpc: jest.Mock) {
  (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ rpc });
}

describe("inventory.server · clave de idempotencia (C6)", () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    (createAdminSupabaseClient as jest.Mock).mockReturnValue({
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            maybeSingle: jest.fn().mockResolvedValue({
              data: { store_id: DEFAULT_STORE_ID },
              error: null,
            }),
          })),
        })),
      })),
    });
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe("createStockAdjustment", () => {
    const input = {
      productId: PRODUCT_ID,
      quantityDelta: 3,
      reason: "Conteo fisico",
      type: "ajuste_entrada" as const,
    };

    it("pasa la clave a adjust_stock como p_client_request_id", async () => {
      const rpc = jest.fn().mockResolvedValue({ data: movementRow, error: null });
      mountRpc(rpc);

      await createStockAdjustment({ ...input, clientRequestId: CLIENT_REQUEST_ID }, DEFAULT_STORE_ID);

      expect(rpc.mock.calls).toEqual([
        ["adjust_stock", { ...adjustArgs, p_client_request_id: CLIENT_REQUEST_ID }],
      ]);
    });

    it("sin clave la llamada es identica a la de siempre", async () => {
      const rpc = jest.fn().mockResolvedValue({ data: movementRow, error: null });
      mountRpc(rpc);

      await createStockAdjustment(input, DEFAULT_STORE_ID);

      expect(rpc.mock.calls).toEqual([["adjust_stock", adjustArgs]]);
    });

    it("si la firma no acepta la clave (PGRST202) reintenta una vez sin ella y lo deja en el log", async () => {
      const rpc = jest
        .fn()
        .mockResolvedValueOnce({ data: null, error: missingSignatureError })
        .mockResolvedValueOnce({ data: movementRow, error: null });
      mountRpc(rpc);

      const result = await createStockAdjustment(
        { ...input, clientRequestId: CLIENT_REQUEST_ID },
        DEFAULT_STORE_ID,
      );

      expect(result.stockAfter).toBe(21);
      expect(rpc.mock.calls).toEqual([
        ["adjust_stock", { ...adjustArgs, p_client_request_id: CLIENT_REQUEST_ID }],
        ["adjust_stock", adjustArgs],
      ]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("adjust_stock");
    });

    it("no reintenta ante un error de negocio", async () => {
      const rpc = jest.fn().mockResolvedValue({
        data: null,
        error: { message: "Stock insuficiente" },
      });
      mountRpc(rpc);

      await expect(
        createStockAdjustment({ ...input, clientRequestId: CLIENT_REQUEST_ID }, DEFAULT_STORE_ID),
      ).rejects.toMatchObject({ status: 400 });
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(warn).not.toHaveBeenCalled();
    });

    it("un PGRST202 sin clave no se reintenta", async () => {
      const rpc = jest.fn().mockResolvedValue({ data: null, error: missingSignatureError });
      mountRpc(rpc);

      await expect(createStockAdjustment(input, DEFAULT_STORE_ID)).rejects.toBeDefined();
      expect(rpc).toHaveBeenCalledTimes(1);
    });
  });

  describe("convertPackToUnits", () => {
    const input = { packProductId: PRODUCT_ID, packQuantity: 1 };

    it("pasa la clave a convert_pack_to_units como p_client_request_id", async () => {
      const rpc = jest.fn().mockResolvedValue({ data: conversionPayload, error: null });
      mountRpc(rpc);

      const result = await convertPackToUnits(
        { ...input, clientRequestId: CLIENT_REQUEST_ID },
        DEFAULT_STORE_ID,
      );

      expect(result.conversionId).toBe(conversionPayload.conversionId);
      expect(rpc.mock.calls).toEqual([
        ["convert_pack_to_units", { ...convertArgs, p_client_request_id: CLIENT_REQUEST_ID }],
      ]);
    });

    it("sin clave la llamada es identica a la de siempre", async () => {
      const rpc = jest.fn().mockResolvedValue({ data: conversionPayload, error: null });
      mountRpc(rpc);

      await convertPackToUnits(input, DEFAULT_STORE_ID);

      expect(rpc.mock.calls).toEqual([["convert_pack_to_units", convertArgs]]);
    });

    it("si la firma no acepta la clave (PGRST202) reintenta una vez sin ella y lo deja en el log", async () => {
      const rpc = jest
        .fn()
        .mockResolvedValueOnce({ data: null, error: missingSignatureError })
        .mockResolvedValueOnce({ data: conversionPayload, error: null });
      mountRpc(rpc);

      const result = await convertPackToUnits(
        { ...input, clientRequestId: CLIENT_REQUEST_ID },
        DEFAULT_STORE_ID,
      );

      expect(result.unitQuantity).toBe(10);
      expect(rpc.mock.calls).toEqual([
        ["convert_pack_to_units", { ...convertArgs, p_client_request_id: CLIENT_REQUEST_ID }],
        ["convert_pack_to_units", convertArgs],
      ]);
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });
});
