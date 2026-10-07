/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client", () => ({
  createRouteSupabaseClient: jest.fn(),
}));

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { resetMockTaxRates } from "@/modules/settings/services/taxRates.testing";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { PATCH } from "./[id]/route";
import { GET, POST } from "./route";

const OTHER_STORE_ID = "00000000-0000-4000-8000-000000000002";

function demoHeaders(role: string, storeId?: string) {
  return {
    "content-type": "application/json",
    "x-demo-role": role,
    ...(storeId ? { "x-demo-store-id": storeId } : {}),
  };
}

function get(role: string, query = "", storeId?: string) {
  return GET(
    new Request(`http://localhost/api/tax-rates${query}`, { headers: demoHeaders(role, storeId) }),
  );
}

function post(role: string, body: unknown, storeId?: string) {
  return POST(
    new Request("http://localhost/api/tax-rates", {
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: demoHeaders(role, storeId),
      method: "POST",
    }),
  );
}

async function listCodes(role = "admin", query = "", storeId?: string) {
  const body = await (await get(role, query, storeId)).json();

  return (body.data.items as Array<{ code: string }>).map((rate) => rate.code);
}

describe("/api/tax-rates", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    jest.clearAllMocks();
    resetMockTaxRates();
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  describe("GET", () => {
    it.each(["admin", "vendedor", "almacen", "contador"])(
      "devuelve al rol %s el catalogo sembrado, ordenado y con la alicuota por defecto",
      async (role) => {
        const response = await get(role);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.data).toEqual({
          items: [
            {
              code: "exento",
              id: "tax-exento",
              isActive: true,
              isDefault: true,
              isGlobal: true,
              label: "Exento",
              pct: 0,
              sortOrder: 10,
            },
            {
              code: "reducida",
              id: "tax-reducida",
              isActive: true,
              isDefault: false,
              isGlobal: true,
              label: "Reducida",
              pct: 8,
              sortOrder: 20,
            },
            {
              code: "general",
              id: "tax-general",
              isActive: true,
              isDefault: false,
              isGlobal: true,
              label: "General",
              pct: 16,
              sortOrder: 30,
            },
          ],
        });
      },
    );

    it("rechaza al superadmin: no opera datos de tienda", async () => {
      expect((await get("superadmin")).status).toBe(403);
    });

    it("lista tambien las inactivas y ?active=true las quita", async () => {
      const created = await (await post("admin", { label: "Lujo", pct: 31 })).json();
      const deactivated = await PATCH(
        new Request(`http://localhost/api/tax-rates/${created.data.id}`, {
          body: JSON.stringify({ isActive: false }),
          headers: demoHeaders("admin"),
          method: "PATCH",
        }),
        { params: Promise.resolve({ id: created.data.id }) },
      );
      expect(deactivated.status).toBe(200);

      const all = await (await get("vendedor")).json();

      expect(all.data.items).toHaveLength(4);
      expect(all.data.items[3]).toEqual(
        expect.objectContaining({ code: "lujo", isActive: false, isGlobal: false }),
      );
      expect(await listCodes("vendedor", "?active=true")).toEqual([
        "exento",
        "reducida",
        "general",
      ]);
    });

    it("una tienda no ve las alicuotas propias de otra", async () => {
      expect((await post("admin", { label: "Lujo", pct: 31 }, OTHER_STORE_ID)).status).toBe(201);

      expect(await listCodes("admin")).not.toContain("lujo");
      expect(await listCodes("admin", "", OTHER_STORE_ID)).toContain("lujo");
    });
  });

  describe("POST", () => {
    it("el admin crea una alicuota de su tienda con el code generado desde el nombre", async () => {
      const response = await post("admin", { label: "  Súper Lujo 31 %  ", pct: 31 });
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.data).toEqual({
        code: "super-lujo-31",
        id: expect.any(String),
        isActive: true,
        isDefault: false,
        isGlobal: false,
        label: "Súper Lujo 31 %",
        pct: 31,
        sortOrder: 40,
      });
    });

    it("acepta un code explicito", async () => {
      const response = await post("admin", { code: "lujo.31", label: "Lujo", pct: 31 });

      expect(response.status).toBe(201);
      expect((await response.json()).data.code).toBe("lujo.31");
    });

    it.each(["vendedor", "almacen", "contador"])("responde 403 al rol %s", async (role) => {
      const response = await post(role, { label: "Lujo", pct: 31 });

      expect(response.status).toBe(403);
      expect(await listCodes()).toHaveLength(3);
    });

    it.each([
      ["pct mayor que 100", { label: "Lujo", pct: 100.01 }],
      ["pct negativo", { label: "Lujo", pct: -1 }],
      ["pct no numerico", { label: "Lujo", pct: "16" }],
      ["label vacio", { label: "   ", pct: 16 }],
      ["label ausente", { pct: 16 }],
      ["code con mayusculas", { code: "Lujo", label: "Lujo", pct: 31 }],
      ["code con espacios", { code: "lujo 31", label: "Lujo", pct: 31 }],
      ["storeId enviado por el cliente", { label: "Lujo", pct: 31, storeId: OTHER_STORE_ID }],
      ["isActive enviado al crear", { isActive: false, label: "Lujo", pct: 31 }],
    ])("responde 400 con %s", async (_case, payload) => {
      const response = await post("admin", payload);

      expect(response.status).toBe(400);
      expect(await listCodes()).toHaveLength(3);
      expect(await listCodes("admin", "", OTHER_STORE_ID)).toHaveLength(3);
    });

    it("responde 400 a un cuerpo que no es JSON", async () => {
      expect((await post("admin", "{")).status).toBe(400);
    });

    it("responde 400 si el nombre no deja ningun caracter para el code", async () => {
      const response = await post("admin", { label: "%%%", pct: 31 });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error.message).toBe(
        "No se pudo generar un codigo a partir del nombre: usa letras o numeros.",
      );
    });

    it("responde 409 si el code ya existe para la tienda, tambien si es de una global", async () => {
      const response = await post("admin", { label: "General", pct: 12 });
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(body.error.message).toBe('Ya existe una alicuota de IVA con el codigo "general".');
      expect(await listCodes()).toHaveLength(3);
    });
  });

  describe("supabase data source", () => {
    const rows = [
      {
        code: "general",
        id: "g-16",
        is_active: true,
        label: "General",
        pct: "16.00",
        sort_order: 30,
        store_id: null,
      },
      {
        code: "exento",
        id: "g-0",
        is_active: true,
        label: "Exento",
        pct: "0.00",
        sort_order: 10,
        store_id: null,
      },
      {
        code: "lujo",
        id: "s-31",
        is_active: false,
        label: "Lujo",
        pct: "31.00",
        sort_order: 40,
        store_id: DEFAULT_STORE_ID,
      },
    ];

    function mountClient(insert = jest.fn()) {
      const rpc = jest.fn().mockResolvedValue({ data: rows, error: null });
      const from = jest.fn((table: string) => {
        if (table === "app_settings") {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                maybeSingle: jest
                  .fn()
                  .mockResolvedValue({ data: { default_tax_rate_id: "g-16" }, error: null }),
              })),
            })),
          };
        }

        return { insert };
      });

      (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from, rpc });

      return { from, rpc };
    }

    beforeEach(() => {
      process.env.API_DATA_SOURCE = "supabase";
    });

    it("lista con tax_rates_for_store de la tienda de la sesion y marca la de app_settings", async () => {
      const { rpc } = mountClient();

      const response = await get("contador", "?active=true");
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(rpc).toHaveBeenCalledWith("tax_rates_for_store", { p_store_id: DEFAULT_STORE_ID });
      expect(body.data.items).toEqual([
        {
          code: "exento",
          id: "g-0",
          isActive: true,
          isDefault: false,
          isGlobal: true,
          label: "Exento",
          pct: 0,
          sortOrder: 10,
        },
        {
          code: "general",
          id: "g-16",
          isActive: true,
          isDefault: true,
          isGlobal: true,
          label: "General",
          pct: 16,
          sortOrder: 30,
        },
      ]);
    });

    it("crea con el store_id de la sesion", async () => {
      const insert = jest.fn(() => ({
        select: jest.fn(() => ({
          single: jest.fn().mockResolvedValue({
            data: {
              code: "premium",
              id: "s-40",
              is_active: true,
              label: "Premium",
              pct: "40.00",
              sort_order: 50,
              store_id: DEFAULT_STORE_ID,
            },
            error: null,
          }),
        })),
      }));
      mountClient(insert);

      const response = await post("admin", { label: "Premium", pct: 40 });

      expect(response.status).toBe(201);
      expect(insert).toHaveBeenCalledWith({
        code: "premium",
        label: "Premium",
        pct: 40,
        sort_order: 50,
        store_id: DEFAULT_STORE_ID,
      });
      expect((await response.json()).data).toEqual(
        expect.objectContaining({ code: "premium", isGlobal: false, pct: 40 }),
      );
    });

    it("no llega a la base si el rol no es admin", async () => {
      const { from, rpc } = mountClient();

      expect((await post("almacen", { label: "Premium", pct: 40 })).status).toBe(403);
      expect(rpc).not.toHaveBeenCalled();
      expect(from).not.toHaveBeenCalled();
    });
  });
});
