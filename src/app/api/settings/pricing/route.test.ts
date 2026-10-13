/**
 * @jest-environment node
 */

jest.mock("../../../../lib/supabase/route-client");

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { updateSettings } from "@/modules/settings/services/settings.mock-server";
import { resetMockTaxRates } from "@/modules/settings/services/taxRates.testing";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { GET } from "./route";

const OTHER_STORE_ID = "00000000-0000-4000-8000-000000000002";
const DEFAULTS = { chipsPct: [12, 20, 30], greenFromPct: 25, yellowFromPct: 15 };
const CUSTOM = { chipsPct: [5, 50], greenFromPct: 40, yellowFromPct: 10 };

function get(headers: Record<string, string> = {}) {
  return GET(new Request("http://localhost/api/settings/pricing", { headers }));
}

describe("/api/settings/pricing", () => {
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

  it.each(["admin", "vendedor", "almacen"])(
    "devuelve los umbrales y chips por defecto a %s (ve productos)",
    async (role) => {
      const response = await get({ "x-demo-role": role });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toEqual(DEFAULTS);
    },
  );

  it("responde 403 a quien no ve productos ni configuración (contador)", async () => {
    const response = await get({ "x-demo-role": "contador" });

    expect(response.status).toBe(403);
  });

  it("devuelve lo configurado en la tienda del usuario, nunca lo de otra", async () => {
    updateSettings({ pricing: CUSTOM }, DEFAULT_STORE_ID);

    const own = await get({ "x-demo-role": "vendedor" });
    const other = await get({ "x-demo-role": "vendedor", "x-demo-store-id": OTHER_STORE_ID });

    expect((await own.json()).data).toEqual(CUSTOM);
    expect((await other.json()).data).toEqual(DEFAULTS);
  });

  it("ignora un storeId enviado por el cliente en la URL", async () => {
    updateSettings({ pricing: CUSTOM }, OTHER_STORE_ID);

    const response = await GET(
      new Request(`http://localhost/api/settings/pricing?storeId=${OTHER_STORE_ID}&store_id=${OTHER_STORE_ID}`),
    );

    expect((await response.json()).data).toEqual(DEFAULTS);
  });

  describe("supabase data source", () => {
    const mockMaybeSingle = jest.fn();
    const mockEq = jest.fn(() => ({ maybeSingle: mockMaybeSingle }));
    const mockSelect = jest.fn(() => ({ eq: mockEq }));
    const mockFrom = jest.fn(() => ({ select: mockSelect }));

    beforeEach(() => {
      process.env.API_DATA_SOURCE = "supabase";
      (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from: mockFrom });
    });

    it("lee las columnas de precios de la tienda de la sesión", async () => {
      mockMaybeSingle.mockResolvedValue({
        data: { margin_green_from_pct: 40, margin_yellow_from_pct: 10, markup_chips_pct: [50, 5] },
        error: null,
      });

      const response = await get({ "x-demo-role": "almacen" });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toEqual(CUSTOM);
      expect(mockFrom).toHaveBeenCalledWith("app_settings");
      expect(mockSelect).toHaveBeenCalledWith("margin_yellow_from_pct, margin_green_from_pct, markup_chips_pct");
      expect(mockEq).toHaveBeenCalledWith("store_id", DEFAULT_STORE_ID);
    });

    it("una tienda sin fila de configuración recibe los valores por defecto", async () => {
      mockMaybeSingle.mockResolvedValue({ data: null, error: null });

      const response = await get();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toEqual(DEFAULTS);
    });
  });
});
