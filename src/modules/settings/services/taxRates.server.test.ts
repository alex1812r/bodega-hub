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
const storeGeneral = { ...globalGeneral, id: "s-16", store_id: DEFAULT_STORE_ID };

type Call = {
  filters: Array<[string, string, unknown]>;
  op: "insert" | "select" | "update";
  payload?: unknown;
  selected?: string;
  table: string;
};

type Result = { count?: number; data?: unknown; error?: unknown };

/** Cliente falso: registra cada consulta y responde con `respond(call)`. */
function mountClient(rates: unknown[], respond: (call: Call) => Result = () => ({})) {
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
  const rpc = jest.fn().mockResolvedValue({ data: rates, error: null });

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
      message: 'Ya existe una alicuota de IVA con el codigo "general".',
      status: 409,
    });
    expect(writes(calls)).toEqual([]);
  });

  it("al cambiar una fila de tienda recoge lo que aun apunte a la global del mismo code", async () => {
    const { calls } = mountClient([storeGeneral], (call) => {
      if (call.table === "app_settings" && call.op === "select") {
        return { data: { default_tax_rate_id: "g-16" } };
      }

      if (call.table === "tax_rates" && call.op === "select") {
        return { data: { id: "g-16" } };
      }

      if (call.table === "tax_rates" && call.op === "update") {
        return { data: { ...storeGeneral, label: "General 16" } };
      }

      return {};
    });

    const rate = await updateTaxRate("s-16", { label: "General 16" }, DEFAULT_STORE_ID);

    expect(rate).toEqual(expect.objectContaining({ id: "s-16", isDefault: true, label: "General 16" }));
    expect(calls.find((call) => call.table === "tax_rates" && call.op === "select")?.filters).toEqual([
      ["is", "store_id", null],
      ["eq", "code", "general"],
    ]);
    expect(writes(calls).map((call) => [call.table, call.payload])).toEqual([
      ["categories", { tax_rate_id: "s-16" }],
      ["app_settings", { default_tax_rate_id: "s-16" }],
      ["tax_rates", { is_active: true, label: "General 16", pct: 16, sort_order: 30 }],
    ]);
  });

  it("desactivar una fila de tienda que es la por defecto responde 409 sin actualizarla", async () => {
    const { calls } = mountClient([storeGeneral], (call) => {
      if (call.table === "app_settings" && call.op === "select") {
        return { data: { default_tax_rate_id: "s-16" } };
      }

      return { count: 0 };
    });

    await expect(updateTaxRate("s-16", { isActive: false }, DEFAULT_STORE_ID)).rejects.toMatchObject({
      status: 409,
    });
    expect(writes(calls).filter((call) => call.table === "tax_rates")).toEqual([]);
  });

  it("reactivar no consulta el uso de la alicuota", async () => {
    const inactive = { ...storeGeneral, is_active: false };
    const { calls } = mountClient([inactive], (call) =>
      call.table === "tax_rates" && call.op === "update"
        ? { data: { ...inactive, is_active: true } }
        : {},
    );

    expect((await updateTaxRate("s-16", { isActive: true }, DEFAULT_STORE_ID)).isActive).toBe(true);
    expect(calls.some((call) => call.table === "categories" && call.op === "select")).toBe(false);
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
