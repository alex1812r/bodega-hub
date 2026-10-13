/**
 * @jest-environment node
 */

import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { CASH_CLOSE_DIFF_ALERT_RANGE_MESSAGE } from "./cashCloseSettings.schemas";
import { getCashCloseSettings, getSettings, updateSettings } from "./settings.mock-server";

const OTHER_STORE_ID = "00000000-0000-4000-8000-000000000002";
/** Tiendas que ningún otro test de este archivo configura. */
const FRESH_STORE_ID = "00000000-0000-4000-8000-0000000000c1";

describe("settings.mock-server · umbral de faltante al cerrar caja (CNF-10)", () => {
  it("sin configurar, toda tienda lee 0 (paridad con el default de la columna)", () => {
    expect(getCashCloseSettings(FRESH_STORE_ID)).toEqual({ cashCloseDiffAlertVes: 0 });
    expect(getSettings(FRESH_STORE_ID).cashCloseDiffAlertVes).toBe(0);
  });

  it("guardar persiste en memoria, con dos decimales, y solo cambia la tienda que guarda", () => {
    const saved = updateSettings({ cashCloseDiffAlertVes: 150.005 }, DEFAULT_STORE_ID);

    expect(saved.cashCloseDiffAlertVes).toBe(150.01);
    expect(getSettings(DEFAULT_STORE_ID).cashCloseDiffAlertVes).toBe(150.01);
    expect(getCashCloseSettings(DEFAULT_STORE_ID)).toEqual({ cashCloseDiffAlertVes: 150.01 });
    expect(getCashCloseSettings(OTHER_STORE_ID)).toEqual({ cashCloseDiffAlertVes: 0 });
  });

  it("guardar otro campo no toca el umbral", () => {
    updateSettings({ cashCloseDiffAlertVes: 80 }, DEFAULT_STORE_ID);

    expect(updateSettings({ invoicePrefix: "FAC" }, DEFAULT_STORE_ID)).toEqual(
      expect.objectContaining({ cashCloseDiffAlertVes: 80, invoicePrefix: "FAC" }),
    );
  });

  it("se puede volver a 0", () => {
    updateSettings({ cashCloseDiffAlertVes: 80 }, DEFAULT_STORE_ID);

    expect(updateSettings({ cashCloseDiffAlertVes: 0 }, DEFAULT_STORE_ID).cashCloseDiffAlertVes).toBe(0);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rechaza con 400 un umbral inválido (%s) y no cambia nada, tampoco los demás campos",
    (cashCloseDiffAlertVes) => {
      updateSettings({ cashCloseDiffAlertVes: 40 }, DEFAULT_STORE_ID);

      expect(() =>
        updateSettings({ cashCloseDiffAlertVes, invoicePrefix: "X" }, DEFAULT_STORE_ID),
      ).toThrow(
        expect.objectContaining({
          code: "BAD_REQUEST",
          message: CASH_CLOSE_DIFF_ALERT_RANGE_MESSAGE,
          status: 400,
        }),
      );
      expect(getCashCloseSettings(DEFAULT_STORE_ID)).toEqual({ cashCloseDiffAlertVes: 40 });
    },
  );
});
