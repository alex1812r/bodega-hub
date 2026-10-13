/**
 * @jest-environment node
 */

import { mockAppSettings } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import {
  PRICING_CHIPS_COUNT_MESSAGE,
  PRICING_CHIPS_DUPLICATED_MESSAGE,
  PRICING_THRESHOLDS_ORDER_MESSAGE,
} from "./pricingSettings.schemas";
import { getPricingSettings, getSettings, updateSettings } from "./settings.mock-server";
import { createTaxRate, listTaxRates, updateTaxRate } from "./taxRates.mock-server";
import { DEFAULT_TAX_RATE_UNAVAILABLE_MESSAGE } from "./taxRates.schemas";
import { resetMockTaxRates } from "./taxRates.testing";

const OTHER_STORE_ID = "00000000-0000-4000-8000-000000000002";
const DEFAULTS = { chipsPct: [12, 20, 30], greenFromPct: 25, yellowFromPct: 15 };
const CUSTOM = { chipsPct: [5, 50], greenFromPct: 40, yellowFromPct: 10 };

describe("settings.mock-server · ajustes de precios", () => {
  beforeEach(() => {
    resetMockTaxRates();
  });

  it("sin configurar, toda tienda lee los valores por defecto de @bodega/core", () => {
    expect(getPricingSettings(DEFAULT_STORE_ID)).toEqual(DEFAULTS);
    expect(getPricingSettings(OTHER_STORE_ID)).toEqual(DEFAULTS);
    expect(getSettings(DEFAULT_STORE_ID).pricing).toEqual(DEFAULTS);
  });

  it("guardar persiste en memoria, ordena los chips y solo cambia la tienda que guarda", () => {
    const saved = updateSettings(
      { pricing: { chipsPct: [50, 5], greenFromPct: 40, yellowFromPct: 10 } },
      OTHER_STORE_ID,
    );

    expect(saved.pricing).toEqual(CUSTOM);
    expect(saved.storeId).toBe(OTHER_STORE_ID);
    expect(getPricingSettings(OTHER_STORE_ID)).toEqual(CUSTOM);
    expect(getSettings(OTHER_STORE_ID).pricing).toEqual(CUSTOM);
    expect(getPricingSettings(DEFAULT_STORE_ID)).toEqual(DEFAULTS);
  });

  it("lo leído es una copia: mutarlo no cambia lo guardado", () => {
    getPricingSettings(DEFAULT_STORE_ID).chipsPct.push(99);

    expect(getPricingSettings(DEFAULT_STORE_ID)).toEqual(DEFAULTS);
    expect(mockAppSettings.pricing).toEqual(DEFAULTS);
  });

  it.each([
    ["umbrales invertidos", { ...CUSTOM, greenFromPct: 5 }, PRICING_THRESHOLDS_ORDER_MESSAGE],
    ["umbrales iguales", { ...CUSTOM, greenFromPct: 10 }, PRICING_THRESHOLDS_ORDER_MESSAGE],
    ["chips vacíos", { ...CUSTOM, chipsPct: [] }, PRICING_CHIPS_COUNT_MESSAGE],
    ["chips repetidos", { ...CUSTOM, chipsPct: [5, 5] }, PRICING_CHIPS_DUPLICATED_MESSAGE],
    ["siete chips", { ...CUSTOM, chipsPct: [1, 2, 3, 4, 5, 6, 7] }, PRICING_CHIPS_COUNT_MESSAGE],
  ])("rechaza %s con 400 y no guarda nada", (_name, pricing, message) => {
    expect(() => updateSettings({ invoicePrefix: "X", pricing }, DEFAULT_STORE_ID)).toThrow(
      expect.objectContaining({ code: "BAD_REQUEST", message, status: 400 }),
    );
    expect(getPricingSettings(DEFAULT_STORE_ID)).toEqual(DEFAULTS);
  });

  it("guardar otro campo no toca los ajustes de precios", () => {
    updateSettings({ pricing: CUSTOM }, DEFAULT_STORE_ID);

    expect(updateSettings({ invoicePrefix: "FAC" }, DEFAULT_STORE_ID)).toEqual(
      expect.objectContaining({ invoicePrefix: "FAC", pricing: CUSTOM }),
    );
  });
});

describe("settings.mock-server · alícuota por defecto para categorías nuevas", () => {
  beforeEach(() => {
    resetMockTaxRates();
  });

  it("elegir una alícuota activa de la tienda la guarda con su porcentaje y la marca por defecto", () => {
    const saved = updateSettings({ defaultTaxRateId: "tax-general" }, DEFAULT_STORE_ID);

    expect(saved).toEqual(expect.objectContaining({ defaultTaxRate: 16, defaultTaxRateId: "tax-general" }));
    expect(getSettings(DEFAULT_STORE_ID)).toEqual(
      expect.objectContaining({ defaultTaxRate: 16, defaultTaxRateId: "tax-general" }),
    );
    expect(
      listTaxRates(DEFAULT_STORE_ID)
        .items.filter((rate) => rate.isDefault)
        .map((rate) => rate.id),
    ).toEqual(["tax-general"]);
  });

  it("con alícuota manda su porcentaje, aunque llegue otro número suelto", () => {
    expect(
      updateSettings({ defaultTaxRate: 3, defaultTaxRateId: "tax-reducida" }, DEFAULT_STORE_ID),
    ).toEqual(expect.objectContaining({ defaultTaxRate: 8, defaultTaxRateId: "tax-reducida" }));
  });

  it("rechaza con 400 una alícuota inexistente, inactiva o de otra tienda, y no cambia nada", () => {
    const inactive = createTaxRate({ label: "Lujo", pct: 31 }, DEFAULT_STORE_ID);
    updateTaxRate(inactive.id, { isActive: false }, DEFAULT_STORE_ID);
    const foreign = createTaxRate({ label: "Ajena", pct: 9 }, OTHER_STORE_ID);

    for (const defaultTaxRateId of ["no-existe", inactive.id, foreign.id]) {
      expect(() => updateSettings({ defaultTaxRateId, pricing: CUSTOM }, DEFAULT_STORE_ID)).toThrow(
        expect.objectContaining({
          code: "BAD_REQUEST",
          message: DEFAULT_TAX_RATE_UNAVAILABLE_MESSAGE,
          status: 400,
        }),
      );
    }

    expect(getSettings(DEFAULT_STORE_ID)).toEqual(
      expect.objectContaining({ defaultTaxRate: 0, defaultTaxRateId: "tax-exento", pricing: DEFAULTS }),
    );
  });

  it("una global que la tienda redefinió ya no existe para ella: manda la suya", () => {
    const own = updateTaxRate("tax-general", { pct: 12 }, DEFAULT_STORE_ID);

    expect(() => updateSettings({ defaultTaxRateId: "tax-general" }, DEFAULT_STORE_ID)).toThrow(
      expect.objectContaining({ status: 400 }),
    );
    expect(updateSettings({ defaultTaxRateId: own.id }, DEFAULT_STORE_ID)).toEqual(
      expect.objectContaining({ defaultTaxRate: 12, defaultTaxRateId: own.id }),
    );
  });
});
