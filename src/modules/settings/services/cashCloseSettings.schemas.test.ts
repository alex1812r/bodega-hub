/**
 * @jest-environment node
 */

import {
  CASH_CLOSE_DIFF_ALERT_MAX,
  CASH_CLOSE_DIFF_ALERT_RANGE_MESSAGE,
  cashCloseDiffAlertVesSchema,
  mapCashCloseDiffAlertVes,
  parseCashCloseDiffAlertVes,
} from "./cashCloseSettings.schemas";

describe("cashCloseSettings.schemas · umbral de faltante al cerrar caja (CNF-10)", () => {
  it.each([
    [0, 0],
    [150, 150],
    [99.994, 99.99],
    [99.995, 100],
    [CASH_CLOSE_DIFF_ALERT_MAX, CASH_CLOSE_DIFF_ALERT_MAX],
  ])("acepta %s y lo guarda con dos decimales (%s)", (input, stored) => {
    expect(parseCashCloseDiffAlertVes(input)).toBe(stored);
  });

  it.each([
    ["negativo", -0.01],
    ["por encima del tope de la columna", CASH_CLOSE_DIFF_ALERT_MAX + 1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["texto", "150"],
    ["null", null],
  ])("rechaza con 400 y el motivo en español un valor %s", (_name, input) => {
    expect(() => parseCashCloseDiffAlertVes(input)).toThrow(
      expect.objectContaining({
        code: "BAD_REQUEST",
        message: CASH_CLOSE_DIFF_ALERT_RANGE_MESSAGE,
        status: 400,
      }),
    );
    expect(cashCloseDiffAlertVesSchema.safeParse(input).error?.issues[0]?.message).toBe(
      CASH_CLOSE_DIFF_ALERT_RANGE_MESSAGE,
    );
  });

  it.each([
    ["sin columna (base sin el parche)", undefined, 0],
    ["null", null, 0],
    ["texto vacío", "", 0],
    ["numeric como texto", "150.50", 150.5],
    ["número", 20, 20],
    ["negativo", "-5", 0],
    ["NaN", "NaN", 0],
    ["no numérico", "abc", 0],
  ])("mapCashCloseDiffAlertVes: %s → %s", (_name, value, expected) => {
    expect(mapCashCloseDiffAlertVes(value)).toBe(expected);
  });
});
