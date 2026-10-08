/**
 * @jest-environment node
 */

jest.mock("../../../../../lib/supabase/route-client", () => ({
  createRouteSupabaseClient: jest.fn(),
}));

jest.mock("../../../../../lib/api/assertStoreResource", () => ({
  ...jest.requireActual("../../../../../lib/api/assertStoreResource"),
  assertSupabaseStoreResource: jest.fn(),
}));

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { applyMockPurchaseCost } from "@/modules/products/services/priceReview.mock-server";
import { createProduct, getProductPriceHistory } from "@/modules/products/services/products.mock-server";
import { mockPurchases } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { POST } from "./route";

const context = (id: string) => ({ params: Promise.resolve({ id }) });

function post(id: string, options: { body?: string; role?: string } = {}) {
  return POST(
    new Request(`http://localhost/api/products/${id}/keep-price`, {
      ...(options.body !== undefined ? { body: options.body } : {}),
      headers: { "content-type": "application/json", "x-demo-role": options.role ?? "admin" },
      method: "POST",
    }),
    context(id),
  );
}

let seq = 0;

function queuedProduct() {
  seq += 1;
  const id = createProduct(
    { currentCostRef: 8, name: `Mantener ${seq}`, salePriceRef: 10, sku: `rev-keep-${seq}` },
    DEFAULT_STORE_ID,
  ).id;
  applyMockPurchaseCost(id, 9, mockPurchases[0].id);

  return id;
}

describe("/api/products/[id]/keep-price", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("keeps the price without a body: history row without price change and the product leaves the queue", async () => {
    const id = queuedProduct();

    const response = await post(id, { role: "almacen" });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.history).toEqual(
      expect.objectContaining({
        kind: "keep",
        previousSalePriceRef: 10,
        productId: id,
        reason: "Precio mantenido",
        salePriceRef: 10,
      }),
    );
    expect(body.data.product).toEqual(expect.objectContaining({ currentCostRef: 9, id, salePriceRef: 10 }));
    expect(body.data.product).not.toHaveProperty("priceReview");
  });

  it("stores the trimmed reason", async () => {
    const id = queuedProduct();

    const response = await post(id, { body: JSON.stringify({ reason: "  Lo reviso el lunes  " }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.history.reason).toBe("Lo reviso el lunes");
    expect(
      getProductPriceHistory(id, new URLSearchParams("limit=50"), DEFAULT_STORE_ID).items[0],
    ).toMatchObject({ kind: "keep", reason: "Lo reviso el lunes" });
  });

  it("returns 400 for a reason longer than 200 characters", async () => {
    const id = queuedProduct();

    const response = await post(id, { body: JSON.stringify({ reason: "x".repeat(201) }) });

    expect(response.status).toBe(400);
  });

  it.each(["vendedor", "contador"])("returns 403 for %s (no products.manage)", async (role) => {
    const id = queuedProduct();

    const response = await post(id, { role });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(getProductPriceHistory(id, new URLSearchParams("limit=50"), DEFAULT_STORE_ID).items).toHaveLength(1);
  });

  it("returns 404 for an unknown product", async () => {
    const response = await post("prod-inexistente");

    expect(response.status).toBe(404);
  });

  it("calls keep_product_price in supabase mode and maps PT403 from the RPC to 403", async () => {
    process.env.API_DATA_SOURCE = "supabase";
    const rpc = jest
      .fn()
      .mockResolvedValue({ data: null, error: { code: "PT403", message: "No autorizado para mantener precios" } });
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from: jest.fn(), rpc });

    const response = await post("prod-1", { body: JSON.stringify({ reason: "Motivo" }) });
    const body = await response.json();

    expect(rpc).toHaveBeenCalledWith("keep_product_price", { p_product_id: "prod-1", p_reason: "Motivo" });
    expect(response.status).toBe(403);
    expect(body.error).toEqual(
      expect.objectContaining({ code: "FORBIDDEN", message: "No autorizado para mantener precios" }),
    );
  });
});
