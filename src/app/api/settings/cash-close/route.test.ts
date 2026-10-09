/**
 * @jest-environment node
 */

jest.mock("../../../../lib/supabase/route-client");

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { updateSettings } from "@/modules/settings/services/settings.mock-server";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { GET } from "./route";

const OTHER_STORE_ID = "00000000-0000-4000-8000-000000000002";

function get(headers: Record<string, string> = {}) {
  return GET(new Request("http://localhost/api/settings/cash-close", { headers }));
}

describe("/api/settings/cash-close", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    jest.clearAllMocks();
    updateSettings({ cashCloseDiffAlertVes: 0 }, DEFAULT_STORE_ID);
    updateSettings({ cashCloseDiffAlertVes: 0 }, OTHER_STORE_ID);
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it.each(["admin", "vendedor", "contador"])(
    "devuelve el umbral por defecto (0) a %s (opera o ve la caja, o ve la configuración)",
    async (role) => {
      const response = await get({ "x-demo-role": role });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toEqual({ cashCloseDiffAlertVes: 0 });
    },
  );

  it("responde 403 a quien no ve la caja ni la configuración (almacen)", async () => {
    const response = await get({ "x-demo-role": "almacen" });

    expect(response.status).toBe(403);
  });

  it("devuelve lo configurado en la tienda del usuario, nunca lo de otra", async () => {
    updateSettings({ cashCloseDiffAlertVes: 150 }, DEFAULT_STORE_ID);

    const own = await get({ "x-demo-role": "vendedor" });
    const other = await get({ "x-demo-role": "vendedor", "x-demo-store-id": OTHER_STORE_ID });

    expect((await own.json()).data).toEqual({ cashCloseDiffAlertVes: 150 });
    expect((await other.json()).data).toEqual({ cashCloseDiffAlertVes: 0 });
  });

  it("ignora un storeId enviado por el cliente en la URL", async () => {
    updateSettings({ cashCloseDiffAlertVes: 150 }, OTHER_STORE_ID);

    const response = await GET(
      new Request(
        `http://localhost/api/settings/cash-close?storeId=${OTHER_STORE_ID}&store_id=${OTHER_STORE_ID}`,
      ),
    );

    expect((await response.json()).data).toEqual({ cashCloseDiffAlertVes: 0 });
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

    it("lee la columna de la tienda de la sesión", async () => {
      mockMaybeSingle.mockResolvedValue({ data: { cash_close_diff_alert_ves: "75.50" }, error: null });

      const response = await get({ "x-demo-role": "vendedor" });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toEqual({ cashCloseDiffAlertVes: 75.5 });
      expect(mockFrom).toHaveBeenCalledWith("app_settings");
      expect(mockSelect).toHaveBeenCalledWith("cash_close_diff_alert_ves");
      expect(mockEq).toHaveBeenCalledWith("store_id", DEFAULT_STORE_ID);
    });

    it("una base sin el parche 20261015a responde 0, no 500", async () => {
      mockMaybeSingle.mockResolvedValue({
        data: null,
        error: {
          code: "42703",
          message: "column app_settings.cash_close_diff_alert_ves does not exist",
        },
      });

      const response = await get();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toEqual({ cashCloseDiffAlertVes: 0 });
    });
  });
});
