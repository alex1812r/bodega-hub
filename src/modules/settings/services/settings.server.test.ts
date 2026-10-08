/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../lib/supabase/admin-client");

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { PRICING_THRESHOLDS_ORDER_MESSAGE } from "./pricingSettings.schemas";
import { getPricingSettings, getSettings, updateSettings } from "./settings.server";
import { DEFAULT_TAX_RATE_UNAVAILABLE_MESSAGE } from "./taxRates.schemas";

const OTHER_STORE_ID = "00000000-0000-4000-8000-000000000002";
const ACTIVE_RATE_ID = "11111111-1111-4111-8111-111111111116";
const INACTIVE_RATE_ID = "22222222-2222-4222-8222-222222222208";

const settingsRow = {
  business_name: "BodegaHub",
  default_tax_rate: "16.00",
  default_tax_rate_id: ACTIVE_RATE_ID,
  enabled_payment_methods: ["efectivo_ves"],
  id: 1,
  invoice_prefix: "FAC",
  low_stock_threshold: 5,
  margin_green_from_pct: "40.00",
  margin_yellow_from_pct: "10.00",
  markup_chips_pct: ["50.00", "5.00"],
};

type Call = {
  filters: Array<[string, unknown]>;
  op: "select" | "update";
  payload?: Record<string, unknown>;
  selected?: string;
  table: string;
};

/** Cliente falso: registra cada consulta a tablas y cada RPC, y responde con `row`. */
function mountClient(row: unknown, rates: unknown = []) {
  const calls: Call[] = [];
  const rpc = jest.fn().mockResolvedValue({ data: rates, error: null });
  const from = jest.fn((table: string) => {
    const call: Call = { filters: [], op: "select", table };
    calls.push(call);
    const builder = {
      eq: (column: string, value: unknown) => {
        call.filters.push([column, value]);
        return builder;
      },
      maybeSingle: () => Promise.resolve({ data: row, error: null }),
      select: (columns: string) => {
        call.selected = columns;
        return builder;
      },
      update: (payload: Record<string, unknown>) => {
        call.op = "update";
        call.payload = payload;
        return builder;
      },
    };

    return builder;
  });

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "user-admin" } }, error: null }) },
    from,
    rpc,
  });

  return { calls, rpc };
}

describe("settings.server · ajustes de precios", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("getSettings expone pricing con los chips en orden ascendente, de la tienda del servidor", async () => {
    const { calls } = mountClient(settingsRow);

    const settings = await getSettings(OTHER_STORE_ID);

    expect(settings).toEqual(
      expect.objectContaining({
        defaultTaxRateId: ACTIVE_RATE_ID,
        pricing: { chipsPct: [5, 50], greenFromPct: 40, yellowFromPct: 10 },
      }),
    );
    expect(calls).toEqual([
      expect.objectContaining({ filters: [["store_id", OTHER_STORE_ID]], op: "select", table: "app_settings" }),
    ]);
    expect(calls[0].selected).toContain("margin_yellow_from_pct, margin_green_from_pct, markup_chips_pct");
  });

  it("getPricingSettings lee solo las tres columnas, una vez, filtrando por la tienda", async () => {
    const { calls } = mountClient(settingsRow);

    await expect(getPricingSettings(DEFAULT_STORE_ID)).resolves.toEqual({
      chipsPct: [5, 50],
      greenFromPct: 40,
      yellowFromPct: 10,
    });
    expect(calls).toEqual([
      {
        filters: [["store_id", DEFAULT_STORE_ID]],
        op: "select",
        selected: "margin_yellow_from_pct, margin_green_from_pct, markup_chips_pct",
        table: "app_settings",
      },
    ]);
  });

  it("una tienda sin fila de configuración usa los valores por defecto de @bodega/core (sin 404)", async () => {
    mountClient(null);

    await expect(getPricingSettings(DEFAULT_STORE_ID)).resolves.toEqual({
      chipsPct: [12, 20, 30],
      greenFromPct: 25,
      yellowFromPct: 15,
    });
  });

  it("updateSettings escribe las tres columnas normalizadas en la fila de la tienda", async () => {
    const { calls, rpc } = mountClient(settingsRow);

    await updateSettings(
      { pricing: { chipsPct: [50, 5.004], greenFromPct: 40, yellowFromPct: 10 } },
      OTHER_STORE_ID,
    );

    expect(calls).toEqual([
      expect.objectContaining({
        filters: [["store_id", OTHER_STORE_ID]],
        op: "update",
        payload: {
          margin_green_from_pct: 40,
          margin_yellow_from_pct: 10,
          markup_chips_pct: [5, 50],
          updated_by: "user-admin",
        },
        table: "app_settings",
      }),
    ]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("unos ajustes inválidos responden 400 sin escribir nada", async () => {
    const { calls } = mountClient(settingsRow);

    await expect(
      updateSettings({ pricing: { chipsPct: [12], greenFromPct: 10, yellowFromPct: 20 } }, DEFAULT_STORE_ID),
    ).rejects.toEqual(
      expect.objectContaining({ code: "BAD_REQUEST", message: PRICING_THRESHOLDS_ORDER_MESSAGE, status: 400 }),
    );
    expect(calls).toEqual([]);
  });

  it("sin pricing en la entrada no toca las columnas de precios", async () => {
    const { calls } = mountClient(settingsRow);

    await updateSettings({ invoicePrefix: "FAC" }, DEFAULT_STORE_ID);

    expect(calls[0].payload).toEqual({ invoice_prefix: "FAC", updated_by: "user-admin" });
  });
});

describe("settings.server · alícuota por defecto para categorías nuevas", () => {
  const rates = [
    { id: ACTIVE_RATE_ID, is_active: true },
    { id: INACTIVE_RATE_ID, is_active: false },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("una alícuota activa de la tienda se guarda por id; el porcentaje lo copia el trigger", async () => {
    const { calls, rpc } = mountClient(settingsRow, rates);

    await updateSettings({ defaultTaxRate: 3, defaultTaxRateId: ACTIVE_RATE_ID }, OTHER_STORE_ID);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("tax_rates_for_store", { p_store_id: OTHER_STORE_ID });
    expect(calls[0].payload).toEqual({ default_tax_rate_id: ACTIVE_RATE_ID, updated_by: "user-admin" });
  });

  it.each([
    ["inactiva", INACTIVE_RATE_ID],
    ["que la tienda no ve (otra tienda o inexistente)", "33333333-3333-4333-8333-333333333333"],
  ])("una alícuota %s responde 400 y no escribe nada", async (_name, defaultTaxRateId) => {
    const { calls } = mountClient(settingsRow, rates);

    await expect(updateSettings({ defaultTaxRateId }, DEFAULT_STORE_ID)).rejects.toEqual(
      expect.objectContaining({
        code: "BAD_REQUEST",
        message: DEFAULT_TAX_RATE_UNAVAILABLE_MESSAGE,
        status: 400,
      }),
    );
    expect(calls).toEqual([]);
  });

  it("sin alícuota, el porcentaje suelto se sigue guardando como hasta ahora", async () => {
    const { calls, rpc } = mountClient(settingsRow, rates);

    await updateSettings({ defaultTaxRate: 8 }, DEFAULT_STORE_ID);

    expect(rpc).not.toHaveBeenCalled();
    expect(calls[0].payload).toEqual({ default_tax_rate: 8, updated_by: "user-admin" });
  });
});
