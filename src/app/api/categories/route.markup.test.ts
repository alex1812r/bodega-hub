/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client", () => ({
  createRouteSupabaseClient: jest.fn(),
}));
jest.mock("../../../lib/supabase/admin-client", () => ({
  createAdminSupabaseClient: jest.fn(),
}));

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { CATEGORY_MARKUP_PCT_RANGE_MESSAGE } from "@/modules/products/services/categorySchemas";
import { getProductById } from "@/modules/products/services/products.mock-server";
import { resetMockTaxRates } from "@/modules/settings/services/taxRates.testing";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { GET as GET_BY_ID, PATCH } from "./[id]/route";
import { GET, POST } from "./route";

/** PRO-09 · `defaultMarkupPct` (% de ganancia sugerido) en /api/categories y /api/categories/{id}. */

const OTHER_STORE_ID = "00000000-0000-4000-8000-000000000002";

function json(method: string, body: unknown, headers: Record<string, string> = {}) {
  return {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
    method,
  };
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(new Request("http://localhost/api/categories", json("POST", body, headers)));
}

function patch(id: string, body: unknown, headers: Record<string, string> = {}) {
  return PATCH(new Request(`http://localhost/api/categories/${id}`, json("PATCH", body, headers)), {
    params: Promise.resolve({ id }),
  });
}

async function read(id: string, headers: Record<string, string> = {}) {
  const response = await GET_BY_ID(new Request(`http://localhost/api/categories/${id}`, { headers }), {
    params: Promise.resolve({ id }),
  });

  return { body: await response.json(), status: response.status };
}

describe("/api/categories · defaultMarkupPct", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    jest.clearAllMocks();
    resetMockTaxRates();
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
    resetMockTaxRates();
  });

  it("una categoría sin sugerencia no trae el campo", async () => {
    const { body } = await read("cat-tools");

    expect(body.data).not.toHaveProperty("defaultMarkupPct");
  });

  it("alta con % sugerido: se guarda a dos decimales y sale en el detalle y en la lista", async () => {
    const response = await post({ defaultMarkupPct: 35.555, name: "Bebidas PRO-09" });
    const created = (await response.json()).data;
    const list = await (await GET(new Request("http://localhost/api/categories?search=Bebidas%20PRO-09"))).json();

    expect(response.status).toBe(201);
    expect(created.defaultMarkupPct).toBe(35.56);
    expect((await read(created.id)).body.data.defaultMarkupPct).toBe(35.56);
    expect(list.data.items).toEqual([expect.objectContaining({ defaultMarkupPct: 35.56, id: created.id })]);
  });

  it("editar lo cambia, null lo borra y no enviarlo lo conserva", async () => {
    const set = await patch("cat-tools", { defaultMarkupPct: 40 });
    const kept = await patch("cat-tools", { description: "Otra descripción" });
    const keptBody = (await kept.json()).data;
    const cleared = await patch("cat-tools", { defaultMarkupPct: null });

    expect(set.status).toBe(200);
    expect((await set.json()).data.defaultMarkupPct).toBe(40);
    expect(keptBody).toEqual(expect.objectContaining({ defaultMarkupPct: 40, description: "Otra descripción" }));
    expect(cleared.status).toBe(200);
    expect((await cleared.json()).data).not.toHaveProperty("defaultMarkupPct");
    expect((await read("cat-tools")).body.data).not.toHaveProperty("defaultMarkupPct");
  });

  it("el producto expone el % sugerido de su categoría donde ya viaja `category`", async () => {
    await patch("cat-tools", { defaultMarkupPct: 40 });

    expect(getProductById("prod-drill", DEFAULT_STORE_ID).category).toEqual(
      expect.objectContaining({ defaultMarkupPct: 40, id: "cat-tools" }),
    );
  });

  it.each([0, -5, 1000.01, "20"])("rechaza %p con 400 en el alta y en la edición, sin guardar", async (value) => {
    const created = await post({ defaultMarkupPct: value, name: "Inválida PRO-09" });
    const updated = await patch("cat-tools", { defaultMarkupPct: value });
    const createdBody = await created.json();
    const list = await (await GET(new Request("http://localhost/api/categories?search=PRO-09"))).json();

    expect(created.status).toBe(400);
    expect(updated.status).toBe(400);
    expect(createdBody.error.issues[0].message).toBe(CATEGORY_MARKUP_PCT_RANGE_MESSAGE);
    expect(list.data.items).toEqual([]);
    expect((await read("cat-tools")).body.data).not.toHaveProperty("defaultMarkupPct");
  });

  it("solo quien gestiona productos lo escribe: vendedor recibe 403", async () => {
    const response = await patch("cat-tools", { defaultMarkupPct: 40 }, { "x-demo-role": "vendedor" });

    expect(response.status).toBe(403);
    expect((await read("cat-tools")).body.data).not.toHaveProperty("defaultMarkupPct");
  });

  it("no se puede escribir la categoría de otra tienda", async () => {
    const response = await patch(
      "cat-tools",
      { defaultMarkupPct: 40 },
      { "x-demo-store-id": OTHER_STORE_ID },
    );

    expect([403, 404]).toContain(response.status);
    expect((await read("cat-tools")).body.data).not.toHaveProperty("defaultMarkupPct");
  });

  describe("supabase data source", () => {
    const row = {
      default_markup_pct: "35.50",
      description: null,
      id: "cat-1",
      is_active: true,
      name: "Bebidas",
      tax_rate: 16,
      tax_rate_id: "rate-16",
    };
    const mockInsert = jest.fn();
    const mockUpdate = jest.fn();
    const mockUpdateEq = jest.fn();

    beforeEach(() => {
      process.env.API_DATA_SOURCE = "supabase";
      const single = jest.fn().mockResolvedValue({ data: row, error: null });
      const updateBuilder = {
        eq: mockUpdateEq,
        select: jest.fn(() => ({ maybeSingle: single })),
      };

      mockUpdateEq.mockReturnValue(updateBuilder);
      mockInsert.mockReturnValue({ select: jest.fn(() => ({ single })) });
      mockUpdate.mockReturnValue(updateBuilder);
      (createAdminSupabaseClient as jest.Mock).mockReturnValue({
        from: jest.fn(() => ({
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              maybeSingle: jest.fn().mockResolvedValue({ data: { store_id: DEFAULT_STORE_ID }, error: null }),
            })),
          })),
        })),
      });
      (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
        from: jest.fn(() => ({ insert: mockInsert, update: mockUpdate })),
      });
    });

    it("el alta envía default_markup_pct con la tienda del servidor y devuelve el número", async () => {
      const response = await post({ defaultMarkupPct: 35.5, name: "Bebidas", storeId: OTHER_STORE_ID });
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(mockInsert).toHaveBeenCalledWith({
        default_markup_pct: 35.5,
        description: null,
        name: "Bebidas",
        store_id: DEFAULT_STORE_ID,
        tax_rate: 16,
      });
      expect(body.data.defaultMarkupPct).toBe(35.5);
    });

    it("el alta sin el campo no envía la columna", async () => {
      await post({ name: "Bebidas" });

      expect(mockInsert.mock.calls[0][0]).not.toHaveProperty("default_markup_pct");
    });

    it("la edición envía el número, o null para borrarlo, filtrando por la tienda", async () => {
      await patch("cat-1", { defaultMarkupPct: 12.345 });
      await patch("cat-1", { defaultMarkupPct: null });
      await patch("cat-1", { name: "Otra" });

      expect(mockUpdate.mock.calls.map(([payload]) => payload)).toEqual([
        { default_markup_pct: 12.35 },
        { default_markup_pct: null },
        { name: "Otra" },
      ]);
      expect(mockUpdateEq).toHaveBeenCalledWith("store_id", DEFAULT_STORE_ID);
    });

    it("un valor fuera de rango responde 400 sin llegar a la base", async () => {
      const response = await patch("cat-1", { defaultMarkupPct: 0 });

      expect(response.status).toBe(400);
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });
});
