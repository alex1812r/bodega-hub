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
    const GLOBAL_ID = "11111111-1111-4111-8111-111111111116";
    const STORE_RATE_ID = "22222222-2222-4222-8222-222222222231";
    const OVERRIDE_ID = "22222222-2222-4222-8222-222222222212";
    const globalGeneral = {
      code: "general",
      id: GLOBAL_ID,
      is_active: true,
      label: "General",
      pct: "16.00",
      sort_order: 30,
      store_id: null,
    };
    const storeLujo = {
      code: "lujo",
      id: STORE_RATE_ID,
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
    function mountClient(
      rpcResult: { data?: unknown; error?: unknown },
      respond: (call: Call) => { count?: number; data?: unknown; error?: unknown } = () => ({}),
    ) {
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
      const rpc = jest.fn().mockResolvedValue({ data: null, error: null, ...rpcResult });

      (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from, rpc });

      return { calls, rpc };
    }

    const writes = (calls: Call[]) => calls.filter((call) => call.op !== "select");

    beforeEach(() => {
      process.env.API_DATA_SOURCE = "supabase";
    });

    it("cambia la fila de la tienda con una sola llamada a la RPC, sin code ni store_id", async () => {
      const { calls, rpc } = mountClient({
        data: { ...storeLujo, label: "Lujo 2026", pct: "32.00" },
      });

      const response = await patch(STORE_RATE_ID, { label: "Lujo 2026", pct: 32 });

      expect(response.status).toBe(200);
      expect((await response.json()).data).toEqual({
        code: "lujo",
        id: STORE_RATE_ID,
        isActive: true,
        isDefault: false,
        isGlobal: false,
        label: "Lujo 2026",
        pct: 32,
        sortOrder: 40,
      });
      expect(rpc.mock.calls).toEqual([
        [
          "override_tax_rate_for_store",
          {
            p_is_active: null,
            p_label: "Lujo 2026",
            p_pct: 32,
            p_sort_order: null,
            p_tax_rate_id: STORE_RATE_ID,
          },
        ],
      ]);
      expect(writes(calls)).toEqual([]);
    });

    it("PATCH de una global: una sola llamada rpc('override_tax_rate_for_store') y ninguna escritura de tablas", async () => {
      const { calls, rpc } = mountClient(
        { data: { ...globalGeneral, id: OVERRIDE_ID, pct: "12.00", store_id: DEFAULT_STORE_ID } },
        (call) =>
          call.table === "app_settings" ? { data: { default_tax_rate_id: OVERRIDE_ID } } : {},
      );

      const response = await patch(GLOBAL_ID, { pct: 12 });

      expect(response.status).toBe(200);
      expect((await response.json()).data).toEqual({
        code: "general",
        id: OVERRIDE_ID,
        isActive: true,
        isDefault: true,
        isGlobal: false,
        label: "General",
        pct: 12,
        sortOrder: 30,
      });
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(rpc).toHaveBeenCalledWith("override_tax_rate_for_store", {
        p_is_active: null,
        p_label: null,
        p_pct: 12,
        p_sort_order: null,
        p_tax_rate_id: GLOBAL_ID,
      });
      expect(writes(calls)).toEqual([]);
      // La alicuota por defecto se lee de la tienda de la sesion, despues del cambio.
      expect(calls).toEqual([
        { filters: [["eq", "store_id", DEFAULT_STORE_ID]], op: "select", table: "app_settings" },
      ]);
    });

    it("responde 409 con el mensaje de la RPC si la alicuota esta en uso", async () => {
      const message =
        'No se puede desactivar la alicuota "Lujo": la usan 3 categorias activas. Reasignalas a otra alicuota antes de desactivarla.';
      const { calls } = mountClient({ error: { code: "PT409", message } });

      const response = await patch(STORE_RATE_ID, { isActive: false });

      expect(response.status).toBe(409);
      expect((await response.json()).error).toEqual(
        expect.objectContaining({ code: "CONFLICT", message }),
      );
      expect(calls).toEqual([]);
    });

    it("responde 404 a un id que la tienda no ve (otra tienda) sin escribir nada", async () => {
      const { calls } = mountClient({
        error: { code: "PT404", message: "Alicuota de IVA no encontrada." },
      });

      const response = await patch("33333333-3333-4333-8333-333333333331", { isActive: false });

      expect(response.status).toBe(404);
      expect((await response.json()).error.message).toBe("Alicuota de IVA no encontrada.");
      expect(calls).toEqual([]);
    });

    it("responde 404 a un id que no es uuid sin llamar a la base", async () => {
      const { rpc } = mountClient({ data: storeLujo });

      expect((await patch("otra-tienda-31", { isActive: false })).status).toBe(404);
      expect(rpc).not.toHaveBeenCalled();
    });

    it("devuelve tal cual los rechazos PT400 y PT403 de la base", async () => {
      mountClient({ error: { code: "PT400", message: "pct no puede ser NaN ni infinito" } });

      const invalid = await patch(STORE_RATE_ID, { pct: 40 });

      expect(invalid.status).toBe(400);
      expect((await invalid.json()).error.message).toBe("pct no puede ser NaN ni infinito");

      mountClient({
        error: { code: "PT403", message: "No autorizado para modificar alicuotas de IVA" },
      });

      expect((await patch(STORE_RATE_ID, { pct: 40 })).status).toBe(403);
    });

    it("no llega a la base si el rol no es admin", async () => {
      const { rpc } = mountClient({ data: storeLujo });

      expect((await patch(STORE_RATE_ID, { pct: 40 }, "almacen")).status).toBe(403);
      expect(rpc).not.toHaveBeenCalled();
    });
  });
});
