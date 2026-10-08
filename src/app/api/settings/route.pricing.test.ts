/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client");

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import {
  PRICING_CHIPS_COUNT_MESSAGE,
  PRICING_CHIPS_DUPLICATED_MESSAGE,
  PRICING_CHIP_RANGE_MESSAGE,
  PRICING_THRESHOLDS_ORDER_MESSAGE,
} from "@/modules/settings/services/pricingSettings.schemas";
import { getPricingSettings } from "@/modules/settings/services/settings.mock-server";
import { DEFAULT_TAX_RATE_UNAVAILABLE_MESSAGE } from "@/modules/settings/services/taxRates.schemas";
import { resetMockTaxRates } from "@/modules/settings/services/taxRates.testing";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { GET, PATCH } from "./route";

/** PRO-09 · `pricing` y `defaultTaxRateId` en /api/settings. */

const OTHER_STORE_ID = "00000000-0000-4000-8000-000000000002";
const DEFAULTS = { chipsPct: [12, 20, 30], greenFromPct: 25, yellowFromPct: 15 };
const CUSTOM = { chipsPct: [5, 50], greenFromPct: 40, yellowFromPct: 10 };

function patch(body: unknown, headers: Record<string, string> = {}) {
  return PATCH(
    new Request("http://localhost/api/settings", {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", ...headers },
      method: "PATCH",
    }),
  );
}

function get(headers: Record<string, string> = {}) {
  return GET(new Request("http://localhost/api/settings", { headers }));
}

describe("/api/settings · pricing", () => {
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

  it("GET expone pricing con los valores por defecto", async () => {
    const body = await (await get()).json();

    expect(body.data.pricing).toEqual(DEFAULTS);
  });

  it("PATCH guarda pricing, devuelve los chips ordenados y el GET siguiente lo conserva", async () => {
    const response = await patch({ pricing: { chipsPct: [50, 5], greenFromPct: 40, yellowFromPct: 10 } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.pricing).toEqual(CUSTOM);
    expect((await (await get()).json()).data.pricing).toEqual(CUSTOM);
  });

  it("guarda en la tienda del usuario, no en la que diga el cuerpo, y no toca otra tienda", async () => {
    const withStore = await patch({ pricing: { ...CUSTOM, storeId: OTHER_STORE_ID } });
    const saved = await patch({ pricing: CUSTOM, storeId: OTHER_STORE_ID });

    expect(withStore.status).toBe(400);
    expect(saved.status).toBe(200);
    expect(getPricingSettings(DEFAULT_STORE_ID)).toEqual(CUSTOM);
    expect(getPricingSettings(OTHER_STORE_ID)).toEqual(DEFAULTS);
    expect(
      (await (await get({ "x-demo-store-id": OTHER_STORE_ID })).json()).data.pricing,
    ).toEqual(DEFAULTS);
  });

  it.each([
    ["umbrales invertidos", { ...CUSTOM, greenFromPct: 5 }, PRICING_THRESHOLDS_ORDER_MESSAGE],
    ["umbrales iguales", { ...CUSTOM, greenFromPct: 10 }, PRICING_THRESHOLDS_ORDER_MESSAGE],
    ["chips vacíos", { ...CUSTOM, chipsPct: [] }, PRICING_CHIPS_COUNT_MESSAGE],
    ["siete chips", { ...CUSTOM, chipsPct: [1, 2, 3, 4, 5, 6, 7] }, PRICING_CHIPS_COUNT_MESSAGE],
    ["chips repetidos", { ...CUSTOM, chipsPct: [12, 12] }, PRICING_CHIPS_DUPLICATED_MESSAGE],
    ["un chip en 0", { ...CUSTOM, chipsPct: [0, 12] }, PRICING_CHIP_RANGE_MESSAGE],
    ["un chip por encima de 1000", { ...CUSTOM, chipsPct: [1000.01] }, PRICING_CHIP_RANGE_MESSAGE],
  ])("PATCH con %s responde 400 con el motivo en español y no guarda", async (_name, pricing, message) => {
    const response = await patch({ pricing });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toEqual(expect.objectContaining({ code: "BAD_REQUEST", message }));
    expect(getPricingSettings(DEFAULT_STORE_ID)).toEqual(DEFAULTS);
  });

  it("PATCH con pricing incompleto responde 400", async () => {
    const response = await patch({ pricing: { greenFromPct: 30 } });

    expect(response.status).toBe(400);
    expect(getPricingSettings(DEFAULT_STORE_ID)).toEqual(DEFAULTS);
  });

  it.each(["vendedor", "almacen", "contador"])("PATCH responde 403 a %s y no guarda", async (role) => {
    const response = await patch({ pricing: CUSTOM }, { "x-demo-role": role });

    expect(response.status).toBe(403);
    expect(getPricingSettings(DEFAULT_STORE_ID)).toEqual(DEFAULTS);
  });

  it("GET responde 403 a quien no tiene settings.view (vendedor)", async () => {
    expect((await get({ "x-demo-role": "vendedor" })).status).toBe(403);
  });

  describe("alícuota por defecto", () => {
    it("PATCH con una alícuota activa la guarda con su porcentaje", async () => {
      const response = await patch({ defaultTaxRateId: "tax-general" });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toEqual(
        expect.objectContaining({ defaultTaxRate: 16, defaultTaxRateId: "tax-general" }),
      );
      expect((await (await get()).json()).data.defaultTaxRateId).toBe("tax-general");
    });

    it("PATCH con una alícuota que no existe para la tienda responde 400", async () => {
      const response = await patch({ defaultTaxRateId: "no-existe" });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error.message).toBe(DEFAULT_TAX_RATE_UNAVAILABLE_MESSAGE);
      expect((await (await get()).json()).data.defaultTaxRateId).toBe("tax-exento");
    });
  });

  describe("supabase data source", () => {
    const row = {
      business_name: "BodegaHub",
      default_tax_rate: 16,
      enabled_payment_methods: ["efectivo_ves"],
      id: 1,
      invoice_prefix: "FAC",
      low_stock_threshold: 5,
      margin_green_from_pct: 40,
      margin_yellow_from_pct: 10,
      markup_chips_pct: [5, 50],
    };
    const mockMaybeSingle = jest.fn();
    const mockUpdateEq = jest.fn(() => ({ select: jest.fn(() => ({ maybeSingle: mockMaybeSingle })) }));
    const mockUpdate = jest.fn(() => ({ eq: mockUpdateEq }));

    beforeEach(() => {
      process.env.API_DATA_SOURCE = "supabase";
      mockMaybeSingle.mockResolvedValue({ data: row, error: null });
      (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
        auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "user-admin" } }, error: null }) },
        from: jest.fn(() => ({
          select: jest.fn(() => ({ eq: jest.fn(() => ({ maybeSingle: mockMaybeSingle })) })),
          update: mockUpdate,
        })),
      });
    });

    it("GET devuelve pricing de las columnas de app_settings", async () => {
      const body = await (await get()).json();

      expect(body.data.pricing).toEqual(CUSTOM);
    });

    it("PATCH escribe las tres columnas en la fila de la tienda de la sesión", async () => {
      const response = await patch({ pricing: { chipsPct: [50, 5], greenFromPct: 40, yellowFromPct: 10 } });

      expect(response.status).toBe(200);
      expect(mockUpdate).toHaveBeenCalledWith({
        margin_green_from_pct: 40,
        margin_yellow_from_pct: 10,
        markup_chips_pct: [5, 50],
        updated_by: "user-admin",
      });
      expect(mockUpdateEq).toHaveBeenCalledWith("store_id", DEFAULT_STORE_ID);
    });

    it("PATCH inválido responde 400 sin llegar a la base", async () => {
      const response = await patch({ pricing: { ...CUSTOM, greenFromPct: 10 } });

      expect(response.status).toBe(400);
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });
});
