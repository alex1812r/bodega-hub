/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../lib/supabase/admin-client");

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { getCategoryById } from "@/modules/products/services/categories.server";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { getSettings } from "./settings.server";
import { createTaxRate, listTaxRates, updateTaxRate } from "./taxRates.server";

const globalGeneral = {
  code: "general",
  id: "g-16",
  is_active: true,
  label: "General",
  pct: "16.00",
  sort_order: 30,
  store_id: null,
};
const GLOBAL_ID = "11111111-1111-4111-8111-111111111116";
const STORE_RATE_ID = "22222222-2222-4222-8222-222222222216";
const storeGeneral = { ...globalGeneral, id: STORE_RATE_ID, store_id: DEFAULT_STORE_ID };

type Call = {
  filters: Array<[string, string, unknown]>;
  op: "insert" | "select" | "update";
  payload?: unknown;
  selected?: string;
  table: string;
};

type Result = { count?: number; data?: unknown; error?: unknown };

/** Cliente falso: registra cada consulta y responde con `respond(call)`. */
function mountClient(
  rates: unknown,
  respond: (call: Call) => Result = () => ({}),
  rpcError: unknown = null,
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
      select: (columns: string) => {
        call.selected = columns;
        return builder;
      },
      single: result,
      then: (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
        result().then(onFulfilled, onRejected),
      update: (payload: unknown) => {
        call.op = "update";
        call.payload = payload;
        return builder;
      },
    };

    return builder;
  });
  const rpc = jest.fn().mockResolvedValue({ data: rpcError ? null : rates, error: rpcError });

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from, rpc });

  return { calls, rpc };
}

const writes = (calls: Call[]) => calls.filter((call) => call.op !== "select");

describe("taxRates.server", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("propaga el error de la base al listar", async () => {
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({ maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }) })),
        })),
      })),
      rpc: jest.fn().mockResolvedValue({ data: null, error: { code: "42501", message: "denied" } }),
    });

    await expect(listTaxRates(DEFAULT_STORE_ID)).rejects.toMatchObject({ status: 403 });
  });

  it("sin alicuota por defecto ninguna sale marcada", async () => {
    mountClient([globalGeneral]);

    expect((await listTaxRates(DEFAULT_STORE_ID)).items).toEqual([
      expect.objectContaining({ id: "g-16", isDefault: false }),
    ]);
  });

  it("no inserta si el code ya lo ve la tienda", async () => {
    const { calls } = mountClient([globalGeneral]);

    await expect(createTaxRate({ label: "General", pct: 12 }, DEFAULT_STORE_ID)).rejects.toMatchObject({
      message: 'Ya existe una alícuota de IVA con el código "general".',
      status: 409,
    });
    expect(writes(calls)).toEqual([]);
  });

  describe("updateTaxRate", () => {
    it("cambiar una global es UNA llamada a override_tax_rate_for_store y ninguna escritura de tablas", async () => {
      const { calls, rpc } = mountClient({ ...storeGeneral, pct: "12.00" }, (call) =>
        call.table === "app_settings" ? { data: { default_tax_rate_id: STORE_RATE_ID } } : {},
      );

      const rate = await updateTaxRate(GLOBAL_ID, { pct: 12 }, DEFAULT_STORE_ID);

      expect(rate).toEqual({
        code: "general",
        id: STORE_RATE_ID,
        isActive: true,
        isDefault: true,
        isGlobal: false,
        label: "General",
        pct: 12,
        sortOrder: 30,
      });
      expect(rpc.mock.calls).toEqual([
        [
          "override_tax_rate_for_store",
          {
            p_is_active: null,
            p_label: null,
            p_pct: 12,
            p_sort_order: null,
            p_tax_rate_id: GLOBAL_ID,
          },
        ],
      ]);
      expect(writes(calls)).toEqual([]);
      expect(calls.map((call) => call.table)).toEqual(["app_settings"]);
    });

    it("manda solo los campos indicados y el porcentaje con dos decimales", async () => {
      const { rpc } = mountClient(storeGeneral);

      await updateTaxRate(
        STORE_RATE_ID,
        { isActive: false, label: "General 16", pct: 15.555, sortOrder: 5 },
        DEFAULT_STORE_ID,
      );

      expect(rpc).toHaveBeenCalledWith("override_tax_rate_for_store", {
        p_is_active: false,
        p_label: "General 16",
        p_pct: 15.56,
        p_sort_order: 5,
        p_tax_rate_id: STORE_RATE_ID,
      });
    });

    it("una global sin cambios vuelve tal cual, marcada como global", async () => {
      mountClient({ ...globalGeneral, id: GLOBAL_ID }, () => ({
        data: { default_tax_rate_id: GLOBAL_ID },
      }));

      expect(await updateTaxRate(GLOBAL_ID, { pct: 16 }, DEFAULT_STORE_ID)).toEqual(
        expect.objectContaining({ id: GLOBAL_ID, isDefault: true, isGlobal: true }),
      );
    });

    it.each([
      [
        "PT409",
        409,
        'No se puede desactivar la alicuota "General": la usan 2 categorias activas. Reasignalas a otra alicuota antes de desactivarla.',
      ],
      ["PT404", 404, "Alicuota de IVA no encontrada."],
      ["PT403", 403, "No autorizado para modificar alicuotas de IVA"],
      ["PT400", 400, "El porcentaje debe estar entre 0 y 100."],
    ])("el rechazo %s de la RPC sale con HTTP %i y su mensaje", async (code, status, message) => {
      const { calls } = mountClient(null, () => ({}), { code, message });

      await expect(
        updateTaxRate(STORE_RATE_ID, { isActive: false }, DEFAULT_STORE_ID),
      ).rejects.toMatchObject({ message, status });
      expect(calls).toEqual([]);
    });

    it("un id que no es uuid responde 404 sin llamar a la base", async () => {
      const { calls, rpc } = mountClient(storeGeneral);

      await expect(updateTaxRate("tax-general", { pct: 12 }, DEFAULT_STORE_ID)).rejects.toMatchObject({
        message: "Alicuota de IVA no encontrada.",
        status: 404,
      });
      expect(rpc).not.toHaveBeenCalled();
      expect(calls).toEqual([]);
    });

    it("si la RPC no devuelve fila responde 500", async () => {
      mountClient(null);

      await expect(updateTaxRate(STORE_RATE_ID, { pct: 12 }, DEFAULT_STORE_ID)).rejects.toMatchObject({
        status: 500,
      });
    });
  });
});

describe("lectura de taxRateId / defaultTaxRateId (SHR-10)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("la categoria devuelve taxRateId y pide la columna", async () => {
    (createAdminSupabaseClient as jest.Mock).mockReturnValue({
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            maybeSingle: jest
              .fn()
              .mockResolvedValue({ data: { store_id: DEFAULT_STORE_ID }, error: null }),
          })),
        })),
      })),
    });
    const { calls } = mountClient([], () => ({
      data: { id: "cat-1", is_active: true, name: "Bebidas", tax_rate: "8.00", tax_rate_id: "g-8" },
    }));

    expect(await getCategoryById("cat-1", DEFAULT_STORE_ID)).toEqual(
      expect.objectContaining({ id: "cat-1", taxRate: 8, taxRateId: "g-8" }),
    );
    expect(calls[0]?.selected).toMatch(/\btax_rate_id\b/);
  });

  it("la configuracion devuelve defaultTaxRateId y pide la columna", async () => {
    const { calls } = mountClient([], () => ({
      data: {
        business_name: "BodegaHub",
        default_tax_rate: "16.00",
        default_tax_rate_id: "g-16",
        id: 1,
        invoice_prefix: "V",
        low_stock_threshold: 5,
      },
    }));

    expect(await getSettings(DEFAULT_STORE_ID)).toEqual(
      expect.objectContaining({ defaultTaxRate: 16, defaultTaxRateId: "g-16" }),
    );
    expect(calls[0]?.selected).toMatch(/\bdefault_tax_rate_id\b/);
  });
});
