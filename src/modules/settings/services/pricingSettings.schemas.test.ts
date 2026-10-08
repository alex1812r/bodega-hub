import { ApiError } from "@/lib/api/apiError";
import { mockAppSettings } from "@/shared/mocks/erp-data";
import { DEFAULT_MARGIN_THRESHOLDS, DEFAULT_MARKUP_CHIPS } from "@/shared/utils/pricing";

import {
  PRICING_CHIPS_COUNT_MESSAGE,
  PRICING_CHIPS_DUPLICATED_MESSAGE,
  PRICING_CHIP_RANGE_MESSAGE,
  PRICING_THRESHOLDS_ORDER_MESSAGE,
  PRICING_THRESHOLD_RANGE_MESSAGE,
  defaultPricingSettings,
  parsePricingSettings,
  pricingSettingsSchema,
} from "./pricingSettings.schemas";

const valid = { chipsPct: [12, 20, 30], greenFromPct: 25, yellowFromPct: 15 };

function messageOf(value: unknown) {
  const parsed = pricingSettingsSchema.safeParse(value);

  return parsed.success ? null : parsed.error.issues[0]?.message;
}

describe("pricingSettings.schemas", () => {
  it("los valores por defecto son los de @bodega/core, y la semilla del mock coincide", () => {
    expect(defaultPricingSettings()).toEqual({
      chipsPct: [...DEFAULT_MARKUP_CHIPS],
      greenFromPct: DEFAULT_MARGIN_THRESHOLDS.high,
      yellowFromPct: DEFAULT_MARGIN_THRESHOLDS.low,
    });
    expect(defaultPricingSettings()).toEqual({ chipsPct: [12, 20, 30], greenFromPct: 25, yellowFromPct: 15 });
    expect(mockAppSettings.pricing).toEqual(defaultPricingSettings());
  });

  it("cada llamada devuelve una copia: cambiarla no altera los valores por defecto", () => {
    defaultPricingSettings().chipsPct.push(99);

    expect(defaultPricingSettings().chipsPct).toEqual([12, 20, 30]);
  });

  it("acepta los bordes: amarillo 0, verde 1000, un solo chip y seis chips", () => {
    expect(pricingSettingsSchema.parse({ chipsPct: [1000], greenFromPct: 1000, yellowFromPct: 0 })).toEqual({
      chipsPct: [1000],
      greenFromPct: 1000,
      yellowFromPct: 0,
    });
    expect(pricingSettingsSchema.parse({ ...valid, chipsPct: [0.01, 5, 10, 15, 20, 25] }).chipsPct).toHaveLength(6);
  });

  it("devuelve los chips en orden ascendente y todo a dos decimales", () => {
    expect(
      pricingSettingsSchema.parse({ chipsPct: [30, 12.345, 20], greenFromPct: 25.004, yellowFromPct: 14.996 }),
    ).toEqual({ chipsPct: [12.35, 20, 30], greenFromPct: 25, yellowFromPct: 15 });
  });

  it.each([
    ["invertidos", { ...valid, greenFromPct: 10, yellowFromPct: 20 }],
    ["iguales", { ...valid, greenFromPct: 20, yellowFromPct: 20 }],
    ["iguales tras redondear", { ...valid, greenFromPct: 20.004, yellowFromPct: 20 }],
  ])("rechaza umbrales %s", (_name, value) => {
    expect(messageOf(value)).toBe(PRICING_THRESHOLDS_ORDER_MESSAGE);
  });

  it.each([
    ["amarillo negativo", { ...valid, yellowFromPct: -0.01 }],
    ["verde por encima de 1000", { ...valid, greenFromPct: 1000.01 }],
    ["un texto", { ...valid, greenFromPct: "25" }],
    ["NaN", { ...valid, yellowFromPct: Number.NaN }],
    ["Infinity", { ...valid, greenFromPct: Number.POSITIVE_INFINITY }],
    ["un umbral ausente", { chipsPct: [12], greenFromPct: 25 }],
  ])("rechaza umbrales fuera de rango: %s", (_name, value) => {
    expect(messageOf(value)).toBe(PRICING_THRESHOLD_RANGE_MESSAGE);
  });

  it.each([
    ["vacíos", []],
    ["siete valores", [1, 2, 3, 4, 5, 6, 7]],
  ])("rechaza chips %s", (_name, chipsPct) => {
    expect(messageOf({ ...valid, chipsPct })).toBe(PRICING_CHIPS_COUNT_MESSAGE);
  });

  it("rechaza que falten los chips", () => {
    expect(messageOf({ greenFromPct: 25, yellowFromPct: 15 })).toBe(PRICING_CHIPS_COUNT_MESSAGE);
  });

  it.each([
    ["cero", [0, 20]],
    ["negativo", [-5]],
    ["por encima de 1000", [1000.01]],
    ["cero tras redondear", [0.004]],
    ["NaN", [Number.NaN]],
    ["Infinity", [Number.POSITIVE_INFINITY]],
    ["un texto", ["12"]],
    ["null", [null]],
  ])("rechaza un chip fuera de rango: %s", (_name, chipsPct) => {
    expect(messageOf({ ...valid, chipsPct })).toBe(PRICING_CHIP_RANGE_MESSAGE);
  });

  it.each([
    ["repetidos", [12, 20, 12]],
    ["repetidos tras redondear", [12, 12.001]],
  ])("rechaza chips %s", (_name, chipsPct) => {
    expect(messageOf({ ...valid, chipsPct })).toBe(PRICING_CHIPS_DUPLICATED_MESSAGE);
  });

  it("rechaza campos desconocidos (storeId nunca llega del cliente)", () => {
    expect(pricingSettingsSchema.safeParse({ ...valid, storeId: "otra" }).success).toBe(false);
  });

  describe("parsePricingSettings", () => {
    it("devuelve los ajustes normalizados", () => {
      expect(parsePricingSettings({ chipsPct: [30, 12], greenFromPct: 40, yellowFromPct: 10 })).toEqual({
        chipsPct: [12, 30],
        greenFromPct: 40,
        yellowFromPct: 10,
      });
    });

    it("responde 400 con el motivo en español", () => {
      let caught: unknown;

      try {
        parsePricingSettings({ ...valid, greenFromPct: 10 });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ApiError);
      expect(caught).toEqual(
        expect.objectContaining({ code: "BAD_REQUEST", message: PRICING_THRESHOLDS_ORDER_MESSAGE, status: 400 }),
      );
    });

    it.each([null, undefined, "x", 5, []])("rechaza %p con 400", (value) => {
      expect(() => parsePricingSettings(value)).toThrow(expect.objectContaining({ status: 400 }));
    });
  });
});
