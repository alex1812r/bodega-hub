/**
 * @jest-environment node
 */
/**
 * PAG-05 · `listPayments` (Supabase) traduce `method`, `from` y `to` a la
 * consulta: metodo exacto y `created_at` dentro de los dias operativos Caracas.
 */

jest.mock("../../../lib/supabase/route-client");

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { listPayments } from "./payments.server";

function createListBuilder() {
  const builder = {
    eq: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    lt: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    range: jest.fn().mockResolvedValue({ count: 0, data: [], error: null }),
    select: jest.fn().mockReturnThis(),
  };

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
    from: jest.fn().mockReturnValue(builder),
  });

  return builder;
}

describe("payments.server · listPayments con method, from y to (PAG-05)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("filtra por metodo y por el rango de dias Caracas, ambos inclusive", async () => {
    const builder = createListBuilder();

    await listPayments(
      new URLSearchParams("method=pago_movil&from=2026-10-01&to=2026-10-06"),
      DEFAULT_STORE_ID,
    );

    expect(builder.eq).toHaveBeenCalledWith("store_id", DEFAULT_STORE_ID);
    expect(builder.eq).toHaveBeenCalledWith("method", "pago_movil");
    // 00:00 Caracas del dia inicial y 00:00 Caracas del dia siguiente al final.
    expect(builder.gte).toHaveBeenCalledWith("created_at", "2026-10-01T04:00:00.000Z");
    expect(builder.lt).toHaveBeenCalledWith("created_at", "2026-10-07T04:00:00.000Z");
  });

  it("con solo `from` o solo `to` aplica un unico limite", async () => {
    const onlyFrom = createListBuilder();
    await listPayments(new URLSearchParams("from=2026-10-01"), DEFAULT_STORE_ID);

    expect(onlyFrom.gte).toHaveBeenCalledWith("created_at", "2026-10-01T04:00:00.000Z");
    expect(onlyFrom.lt).not.toHaveBeenCalled();

    const onlyTo = createListBuilder();
    await listPayments(new URLSearchParams("to=2026-10-06"), DEFAULT_STORE_ID);

    expect(onlyTo.lt).toHaveBeenCalledWith("created_at", "2026-10-07T04:00:00.000Z");
    expect(onlyTo.gte).not.toHaveBeenCalled();
  });

  it("sin filtros nuevos no toca metodo ni fechas", async () => {
    const builder = createListBuilder();

    await listPayments(new URLSearchParams("direction=entrada"), DEFAULT_STORE_ID);

    expect(builder.eq).toHaveBeenCalledWith("direction", "entrada");
    expect(builder.eq).not.toHaveBeenCalledWith("method", expect.anything());
    expect(builder.gte).not.toHaveBeenCalled();
    expect(builder.lt).not.toHaveBeenCalled();
  });

  it("salePaymentsOnly sigue excluyendo las compras junto a los filtros nuevos", async () => {
    const builder = createListBuilder();

    await listPayments(
      new URLSearchParams("method=efectivo_ves&from=2026-10-01"),
      DEFAULT_STORE_ID,
      { salePaymentsOnly: true },
    );

    expect(builder.is).toHaveBeenCalledWith("purchase_id", null);
    expect(builder.eq).toHaveBeenCalledWith("method", "efectivo_ves");
    expect(builder.gte).toHaveBeenCalledWith("created_at", "2026-10-01T04:00:00.000Z");
  });
});
