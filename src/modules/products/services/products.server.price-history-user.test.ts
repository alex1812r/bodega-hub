/**
 * @jest-environment node
 */
/**
 * PRO-F7 · QA PRO-11 (solo visible con base real): la columna "Usuario" del
 * historial de precios mostraba el UUID de `changed_by`. El nombre sale del
 * embed de `profiles` en la MISMA lectura (sin N+1), como en pagos; lo que la
 * RLS de `profiles` no deja ver llega como `null`.
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../lib/supabase/admin-client");

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { mockProductPriceHistory } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { PRICE_BASELINE_REASON } from "./priceReview";
import { getProductPriceHistory as getMockProductPriceHistory } from "./products.mock-server";
import { getProductPriceHistory } from "./products.server";

const USER_ID = "ecb7f7ff-98e6-487f-ae53-da7a067e1350";

function historyRow(id: string, changedBy: string | null, profile: unknown) {
  return {
    changed_by: changedBy,
    changed_by_profile: profile,
    created_at: "2026-05-20T10:00:00.000Z",
    id,
    new_sale_price_ref: 13,
    old_sale_price_ref: 12,
    product_id: "prod-1",
    reason: null,
  };
}

function mountSupabase(rows: unknown[]) {
  const reads: { select: string; table: string }[] = [];

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
    from: jest.fn((table: string) => {
      const chain: Record<string, jest.Mock> = {
        eq: jest.fn(),
        order: jest.fn(),
        range: jest.fn().mockResolvedValue({ count: rows.length, data: rows, error: null }),
        select: jest.fn((columns: string) => {
          reads.push({ select: columns, table });
          return chain;
        }),
      };

      chain.order.mockReturnValue(chain);
      // `products` con `head: true` se espera tras el último `eq`.
      chain.eq.mockReturnValue(
        table === "product_price_history"
          ? chain
          : Object.assign(Promise.resolve({ count: 1, error: null }), chain),
      );

      return chain;
    }),
  });
  (createAdminSupabaseClient as jest.Mock).mockReturnValue({
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: jest.fn().mockResolvedValue({ data: { store_id: DEFAULT_STORE_ID }, error: null }),
        })),
      })),
    })),
  });

  return reads;
}

describe("getProductPriceHistory · nombre del usuario (PRO-F7)", () => {
  it("devuelve el nombre del perfil de cada fila y `null` cuando no hay usuario o no es visible", async () => {
    mountSupabase([
      historyRow("h-3", USER_ID, { full_name: "Ana Pérez", id: USER_ID }),
      // PostgREST puede devolver el embed como lista.
      historyRow("h-2", USER_ID, [{ full_name: "  ", id: USER_ID }]),
      // Otro usuario que la RLS de `profiles` no deja leer.
      historyRow("h-1", "otro-usuario", null),
      // Línea base creada por migración: sin usuario.
      historyRow("h-0", null, null),
    ]);

    const history = await getProductPriceHistory("prod-1", new URLSearchParams(), DEFAULT_STORE_ID);

    expect(history.items.map((item) => [item.id, item.userId, item.userName])).toEqual([
      ["h-3", USER_ID, "Ana Pérez"],
      ["h-2", USER_ID, null],
      ["h-1", "otro-usuario", null],
      ["h-0", "", null],
    ]);
  });

  it("lee el nombre en la misma consulta del historial: ninguna lectura por fila ni de `profiles`", async () => {
    const reads = mountSupabase([
      historyRow("h-2", USER_ID, { full_name: "Ana Pérez", id: USER_ID }),
      historyRow("h-1", USER_ID, { full_name: "Ana Pérez", id: USER_ID }),
    ]);

    await getProductPriceHistory("prod-1", new URLSearchParams(), DEFAULT_STORE_ID);

    expect(reads.map((read) => read.table)).toEqual(["products", "product_price_history"]);
    expect(reads[1]?.select).toContain(
      "changed_by_profile:profiles!product_price_history_changed_by_fkey(id, full_name)",
    );
  });
});

describe("getProductPriceHistory (mock) · nombre del usuario (PRO-F7)", () => {
  it("resuelve el nombre con los perfiles del mock y deja `null` la línea base sin usuario", () => {
    mockProductPriceHistory.push({
      createdAt: "2020-01-01T00:00:00.000Z",
      id: "f7-price-baseline",
      previousSalePriceRef: 15,
      productId: "prod-drill",
      reason: PRICE_BASELINE_REASON,
      salePriceRef: 15,
      userId: "",
    });

    const history = getMockProductPriceHistory("prod-drill", new URLSearchParams("limit=100"), DEFAULT_STORE_ID);
    const byId = new Map(history.items.map((item) => [item.id, item]));

    expect(byId.get("price-drill-002")).toMatchObject({ userId: "user-admin", userName: "Admin Demo" });
    expect(byId.get("f7-price-baseline")).toMatchObject({ userId: "", userName: null });
  });
});
