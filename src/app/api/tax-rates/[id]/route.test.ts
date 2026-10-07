/**
 * @jest-environment node
 */

jest.mock("../../../../lib/supabase/route-client", () => ({
  createRouteSupabaseClient: jest.fn(),
}));

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { resetMockTaxRates } from "@/modules/settings/services/taxRates.testing";
import { mockAppSettings, mockCategories } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { GET, POST } from "../route";
import { PATCH } from "./route";

const OTHER_STORE_ID = "00000000-0000-4000-8000-000000000002";

type TaxRateBody = {
  code: string;
  id: string;
  isActive: boolean;
  isDefault: boolean;
  isGlobal: boolean;
  label: string;
  pct: number;
  sortOrder: number;
};

function demoHeaders(role: string, storeId?: string) {
  return {
    "content-type": "application/json",
    "x-demo-role": role,
    ...(storeId ? { "x-demo-store-id": storeId } : {}),
  };
}

function patch(id: string, body: unknown, role = "admin", storeId?: string) {
  return PATCH(
    new Request(`http://localhost/api/tax-rates/${id}`, {
      body: JSON.stringify(body),
      headers: demoHeaders(role, storeId),
      method: "PATCH",
    }),
    { params: Promise.resolve({ id }) },
  );
}

async function createRate(body: unknown, storeId?: string) {
  const response = await POST(
    new Request("http://localhost/api/tax-rates", {
      body: JSON.stringify(body),
      headers: demoHeaders("admin", storeId),
      method: "POST",
    }),
  );

  return (await response.json()).data as TaxRateBody;
}

async function listRates(storeId?: string, query = "") {
  const response = await GET(
    new Request(`http://localhost/api/tax-rates${query}`, {
      headers: demoHeaders("admin", storeId),
    }),
  );

  return (await response.json()).data.items as TaxRateBody[];
}

describe("/api/tax-rates/[id]", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    jest.clearAllMocks();
    resetMockTaxRates();
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("el admin cambia nombre, porcentaje, orden y estado de una alicuota de su tienda", async () => {
    const created = await createRate({ label: "Lujo", pct: 31 });

    const response = await patch(created.id, {
      isActive: false,
      label: "Lujo 2026",
      pct: 31.5,
      sortOrder: 5,
    });

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({
      code: "lujo",
      id: created.id,
      isActive: false,
      isDefault: false,
      isGlobal: false,
      label: "Lujo 2026",
      pct: 31.5,
      sortOrder: 5,
    });
    expect((await listRates())[0]).toEqual(expect.objectContaining({ id: created.id, pct: 31.5 }));
  });

  it.each(["vendedor", "almacen", "contador"])("responde 403 al rol %s", async (role) => {
    const created = await createRate({ label: "Lujo", pct: 31 });

    expect((await patch(created.id, { label: "Otro" }, role)).status).toBe(403);
    expect((await listRates()).find((rate) => rate.id === created.id)?.label).toBe("Lujo");
  });

  it.each([
    ["pct mayor que 100", { pct: 101 }],
    ["pct negativo", { pct: -0.01 }],
    ["label vacio", { label: "  " }],
    ["intento de cambiar code", { code: "otro", label: "Lujo" }],
    ["intento de cambiar storeId", { label: "Lujo", storeId: OTHER_STORE_ID }],
    ["sortOrder decimal", { sortOrder: 1.5 }],
    ["cuerpo sin cambios", {}],
  ])("responde 400 con %s", async (_case, payload) => {
    const created = await createRate({ label: "Lujo", pct: 31 });

    expect((await patch(created.id, payload)).status).toBe(400);
    expect((await listRates()).find((rate) => rate.id === created.id)).toEqual(created);
  });

  it("responde 404 a un id que no existe", async () => {
    const response = await patch("tax-nope", { label: "Otro" });

    expect(response.status).toBe(404);
    expect((await response.json()).error.message).toBe("Alicuota de IVA no encontrada.");
  });

  it("responde 404 a la alicuota de otra tienda y no la toca", async () => {
    const theirs = await createRate({ label: "Lujo", pct: 31 }, OTHER_STORE_ID);

    const response = await patch(theirs.id, { isActive: false, label: "Robada" });

    expect(response.status).toBe(404);
    expect((await listRates(OTHER_STORE_ID)).find((rate) => rate.id === theirs.id)).toEqual(theirs);
  });

  describe("desactivar una alicuota en uso", () => {
    it("responde 409 y dice cuantas categorias activas usan General", async () => {
      const response = await patch("tax-general", { isActive: false });
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(body.error).toEqual({
        code: "CONFLICT",
        message:
          'No se puede desactivar la alicuota "General": la usan 4 categorias activas. Reasignalas a otra alicuota antes de desactivarla.',
      });
      expect(await listRates()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "tax-general", isActive: true, isGlobal: true }),
        ]),
      );
      expect(await listRates()).toHaveLength(3);
    });

    it("responde 409 si es la alicuota por defecto de la tienda", async () => {
      const response = await patch("tax-exento", { isActive: false });
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(body.error.message).toBe(
        'No se puede desactivar la alicuota "Exento": es la alicuota por defecto de la tienda (la usan 0 categorias activas). Elige otra por defecto antes de desactivarla.',
      );
    });

    it("cuenta tambien las categorias de una alicuota propia de la tienda", async () => {
      const created = await createRate({ label: "Lujo", pct: 31 });
      const category = mockCategories.find((item) => item.id === "cat-tools");
      Object.assign(category ?? {}, { taxRate: 31, taxRateId: created.id });

      const response = await patch(created.id, { isActive: false });

      expect(response.status).toBe(409);
      expect((await response.json()).error.message).toBe(
        'No se puede desactivar la alicuota "Lujo": la usa 1 categoria activa. Reasignalas a otra alicuota antes de desactivarla.',
      );
    });

    it("las categorias inactivas no bloquean y otros cambios si se aplican a una en uso", async () => {
      const created = await createRate({ label: "Lujo", pct: 31 });
      const archived = mockCategories.find((item) => item.id === "cat-archived");
      Object.assign(archived ?? {}, { taxRate: 31, taxRateId: created.id });

      expect((await patch(created.id, { isActive: false })).status).toBe(200);
      expect((await patch("tax-general", { sortOrder: 31 })).status).toBe(200);
    });
  });

  describe("alicuotas globales", () => {
    it("desactivar una global sin uso crea la fila propia de la tienda y deja intacta la global", async () => {
      const response = await patch("tax-reducida", { isActive: false });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toEqual({
        code: "reducida",
        id: expect.not.stringMatching(/^tax-reducida$/),
        isActive: false,
        isDefault: false,
        isGlobal: false,
        label: "Reducida",
        pct: 8,
        sortOrder: 20,
      });

      // La tienda ve su fila en lugar de la global; las demas tiendas siguen igual.
      expect((await listRates()).filter((rate) => rate.code === "reducida")).toEqual([body.data]);
      expect((await listRates(undefined, "?active=true")).map((rate) => rate.code)).toEqual([
        "exento",
        "general",
      ]);
      expect((await listRates(OTHER_STORE_ID)).find((rate) => rate.code === "reducida")).toEqual(
        expect.objectContaining({ id: "tax-reducida", isActive: true, isGlobal: true }),
      );

      // La global ya no existe para esta tienda: su id antiguo responde 404.
      expect((await patch("tax-reducida", { isActive: true })).status).toBe(404);
      expect((await patch(body.data.id, { isActive: true })).status).toBe(200);
    });

    it("cambiar el porcentaje de una global en uso mueve las categorias y la alicuota por defecto a la fila de la tienda", async () => {
      const general = (await (await patch("tax-general", { pct: 12 })).json()).data as TaxRateBody;
      const exento = (await (await patch("tax-exento", { label: "Exenta" })).json())
        .data as TaxRateBody;

      expect(general).toEqual(
        expect.objectContaining({ code: "general", isGlobal: false, pct: 12 }),
      );
      expect(exento).toEqual(
        expect.objectContaining({ code: "exento", isDefault: true, isGlobal: false, label: "Exenta" }),
      );
      expect(
        mockCategories
          .filter((category) => category.isActive)
          .map((category) => [category.taxRateId, category.taxRate]),
      ).toEqual(Array.from({ length: 4 }, () => [general.id, 12]));
      expect(mockAppSettings.defaultTaxRateId).toBe(exento.id);

      // La regla de desactivacion sigue a la fila de la tienda.
      const blocked = await patch(general.id, { isActive: false });
      expect(blocked.status).toBe(409);
      expect((await blocked.json()).error.message).toContain("la usan 4 categorias activas");
    });

    it("un PATCH que no cambia nada de una global no crea fila de tienda", async () => {
      const response = await patch("tax-general", { isActive: true, pct: 16 });

      expect(response.status).toBe(200);
      expect((await response.json()).data).toEqual(
        expect.objectContaining({ id: "tax-general", isGlobal: true }),
      );
    });
  });

  it("cambiar el porcentaje de una alicuota lo copia a sus categorias", async () => {
    const created = await createRate({ label: "Lujo", pct: 31 });
    const category = mockCategories.find((item) => item.id === "cat-paint");
    Object.assign(category ?? {}, { taxRate: 31, taxRateId: created.id });

    expect((await patch(created.id, { pct: 33 })).status).toBe(200);
    expect(mockCategories.find((item) => item.id === "cat-paint")?.taxRate).toBe(33);
    expect(mockCategories.find((item) => item.id === "cat-tools")?.taxRate).toBe(16);
  });

  describe("supabase data source", () => {
    const globalGeneral = {
      code: "general",
      id: "g-16",
      is_active: true,
      label: "General",
      pct: "16.00",
      sort_order: 30,
      store_id: null,
    };
    const storeLujo = {
      code: "lujo",
      id: "s-31",
      is_active: true,
      label: "Lujo",
      pct: "31.00",
      sort_order: 40,
      store_id: DEFAULT_STORE_ID,
    };

    type Call = {
      filters: Array<[string, string, unknown]>;
      op: "insert" | "select" | "update";
      payload?: unknown;
      table: string;
    };

    /** Cliente falso: registra cada consulta y responde con `respond(call)`. */
    function mountClient(respond: (call: Call) => { count?: number; data?: unknown; error?: unknown }) {
      const calls: Call[] = [];
      const from = jest.fn((table: string) => {
        const call: Call = { filters: [], op: "select", table };
        calls.push(call);
        const result = () => Promise.resolve({ data: null, error: null, ...respond(call) });
        const builder = {
          eq: (column: string, value: unknown) => {
            call.filters.push(["eq", column, value]);
            return builder;
          },
          insert: (payload: unknown) => {
            call.op = "insert";
            call.payload = payload;
            return builder;
          },
          is: (column: string, value: unknown) => {
            call.filters.push(["is", column, value]);
            return builder;
          },
          maybeSingle: result,
          select: () => builder,
          single: result,
          then: (
            onFulfilled: (value: unknown) => unknown,
            onRejected?: (reason: unknown) => unknown,
          ) => result().then(onFulfilled, onRejected),
          update: (payload: unknown) => {
            call.op = "update";
            call.payload = payload;
            return builder;
          },
        };

        return builder;
      });
      const rpc = jest.fn().mockResolvedValue({ data: [globalGeneral, storeLujo], error: null });

      (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from, rpc });

      return { calls, rpc };
    }

    const writes = (calls: Call[]) => calls.filter((call) => call.op !== "select");

    beforeEach(() => {
      process.env.API_DATA_SOURCE = "supabase";
    });

    it("actualiza la fila de la tienda acotada a su store_id y sin code ni store_id en el cambio", async () => {
      const { calls } = mountClient((call) => {
        if (call.table === "tax_rates" && call.op === "update") {
          return { data: { ...storeLujo, label: "Lujo 2026", pct: "32.00" } };
        }

        return {};
      });

      const response = await patch("s-31", { label: "Lujo 2026", pct: 32 });

      expect(response.status).toBe(200);
      expect((await response.json()).data).toEqual({
        code: "lujo",
        id: "s-31",
        isActive: true,
        isDefault: false,
        isGlobal: false,
        label: "Lujo 2026",
        pct: 32,
        sortOrder: 40,
      });
      expect(writes(calls).filter((call) => call.table === "tax_rates")).toEqual([
        {
          filters: [
            ["eq", "id", "s-31"],
            ["eq", "store_id", DEFAULT_STORE_ID],
          ],
          op: "update",
          payload: { is_active: true, label: "Lujo 2026", pct: 32, sort_order: 40 },
          table: "tax_rates",
        },
      ]);
    });

    it("responde 409 con el numero de categorias y no escribe si la alicuota esta en uso", async () => {
      const { calls } = mountClient((call) => {
        if (call.table === "categories" && call.op === "select") {
          return { count: 3 };
        }

        return {};
      });

      const response = await patch("s-31", { isActive: false });

      expect(response.status).toBe(409);
      expect((await response.json()).error.message).toBe(
        'No se puede desactivar la alicuota "Lujo": la usan 3 categorias activas. Reasignalas a otra alicuota antes de desactivarla.',
      );
      expect(calls.find((call) => call.table === "categories" && call.op === "select")?.filters).toEqual([
        ["eq", "store_id", DEFAULT_STORE_ID],
        ["eq", "tax_rate_id", "s-31"],
        ["eq", "is_active", true],
      ]);
      expect(writes(calls).filter((call) => call.table === "tax_rates")).toEqual([]);
    });

    it("responde 409 si es la alicuota por defecto de la tienda", async () => {
      const { calls } = mountClient((call) => {
        if (call.table === "app_settings" && call.op === "select") {
          return { data: { default_tax_rate_id: "g-16" } };
        }

        return { count: 0 };
      });

      const response = await patch("g-16", { isActive: false });

      expect(response.status).toBe(409);
      expect((await response.json()).error.message).toContain(
        "es la alicuota por defecto de la tienda",
      );
      expect(writes(calls)).toEqual([]);
    });

    it("nunca escribe la global: inserta la fila de la tienda y le pasa categorias y por defecto", async () => {
      const override = { ...globalGeneral, id: "s-12", pct: "12.00", store_id: DEFAULT_STORE_ID };
      const { calls } = mountClient((call) => {
        if (call.table === "app_settings" && call.op === "select") {
          return { data: { default_tax_rate_id: "g-16" } };
        }

        if (call.table === "tax_rates" && call.op === "insert") {
          return { data: override };
        }

        if (call.table === "tax_rates" && call.op === "select") {
          return { data: { id: "g-16" } };
        }

        return {};
      });

      const response = await patch("g-16", { pct: 12 });

      expect(response.status).toBe(200);
      expect((await response.json()).data).toEqual({
        code: "general",
        id: "s-12",
        isActive: true,
        isDefault: true,
        isGlobal: false,
        label: "General",
        pct: 12,
        sortOrder: 30,
      });
      expect(writes(calls)).toEqual([
        {
          filters: [],
          op: "insert",
          payload: {
            code: "general",
            is_active: true,
            label: "General",
            pct: 12,
            sort_order: 30,
            store_id: DEFAULT_STORE_ID,
          },
          table: "tax_rates",
        },
        {
          filters: [
            ["eq", "store_id", DEFAULT_STORE_ID],
            ["eq", "tax_rate_id", "g-16"],
          ],
          op: "update",
          payload: { tax_rate_id: "s-12" },
          table: "categories",
        },
        {
          filters: [
            ["eq", "store_id", DEFAULT_STORE_ID],
            ["eq", "default_tax_rate_id", "g-16"],
          ],
          op: "update",
          payload: { default_tax_rate_id: "s-12" },
          table: "app_settings",
        },
      ]);
    });

    it("responde 404 a un id que la tienda no ve (otra tienda) sin escribir nada", async () => {
      const { calls } = mountClient(() => ({}));

      const response = await patch("otra-tienda-31", { isActive: false });

      expect(response.status).toBe(404);
      expect(writes(calls)).toEqual([]);
    });

    it("devuelve tal cual el rechazo PT400 de la base", async () => {
      mountClient((call) => {
        if (call.table === "tax_rates" && call.op === "update") {
          return { error: { code: "PT400", message: "pct no puede ser NaN ni infinito" } };
        }

        return {};
      });

      const response = await patch("s-31", { pct: 40 });

      expect(response.status).toBe(400);
      expect((await response.json()).error.message).toBe("pct no puede ser NaN ni infinito");
    });
  });
});
