/**
 * @jest-environment node
 */

import {
  CASH_CLOSE_DIFF_ALERT_RANGE_MESSAGE,
} from "@/modules/settings/services/cashCloseSettings.schemas";
import { getCashCloseSettings, updateSettings } from "@/modules/settings/services/settings.mock-server";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { GET, PATCH } from "./route";

const OTHER_STORE_ID = "00000000-0000-4000-8000-000000000002";

function patch(body: unknown, headers: Record<string, string> = {}) {
  return PATCH(
    new Request("http://localhost/api/settings", {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", ...headers },
      method: "PATCH",
    }),
  );
}

describe("/api/settings · cashCloseDiffAlertVes (CNF-10)", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    updateSettings({ cashCloseDiffAlertVes: 0 }, DEFAULT_STORE_ID);
    updateSettings({ cashCloseDiffAlertVes: 0 }, OTHER_STORE_ID);
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("GET lo devuelve como número, 0 por defecto", async () => {
    const response = await GET(new Request("http://localhost/api/settings"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.cashCloseDiffAlertVes).toBe(0);
  });

  it("PATCH del admin lo guarda con dos decimales y GET lo lee después", async () => {
    const response = await patch({ cashCloseDiffAlertVes: 150.005 });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.cashCloseDiffAlertVes).toBe(150.01);

    const read = await GET(new Request("http://localhost/api/settings"));

    expect((await read.json()).data.cashCloseDiffAlertVes).toBe(150.01);
  });

  it("solo quien puede editar los ajustes de la tienda lo cambia: vendedor y contador reciben 403", async () => {
    for (const role of ["vendedor", "contador", "almacen"]) {
      const response = await patch({ cashCloseDiffAlertVes: 500 }, { "x-demo-role": role });

      expect(response.status).toBe(403);
    }

    expect(getCashCloseSettings(DEFAULT_STORE_ID)).toEqual({ cashCloseDiffAlertVes: 0 });
  });

  it("escribe en la tienda del servidor: un storeId en el cuerpo no cambia otra tienda", async () => {
    const response = await patch({ cashCloseDiffAlertVes: 90, storeId: OTHER_STORE_ID });

    expect(response.status).toBe(200);
    expect(getCashCloseSettings(DEFAULT_STORE_ID)).toEqual({ cashCloseDiffAlertVes: 90 });
    expect(getCashCloseSettings(OTHER_STORE_ID)).toEqual({ cashCloseDiffAlertVes: 0 });
  });

  it.each([
    ["negativo", -1],
    ["texto", "150"],
    ["null", null],
  ])("un valor %s responde 400 con el motivo en español y no guarda nada", async (_name, value) => {
    const response = await patch({ cashCloseDiffAlertVes: value, invoicePrefix: "X" });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.message).toBe(CASH_CLOSE_DIFF_ALERT_RANGE_MESSAGE);
    expect(getCashCloseSettings(DEFAULT_STORE_ID)).toEqual({ cashCloseDiffAlertVes: 0 });
  });
});
