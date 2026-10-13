/**
 * @jest-environment node
 */

import {
  createCategory,
  getCategoryById,
  listCategories,
  updateCategory,
} from "@/modules/products/services/categories.mock-server";
import { mockAppSettings, mockCategories, mockTaxRates } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { getSettings } from "./settings.mock-server";
import {
  createTaxRate,
  findActiveMockTaxRateByCode,
  findMockTaxRateForPct,
  listTaxRates,
  mockTaxRatesForStore,
  updateTaxRate,
} from "./taxRates.mock-server";
import {
  buildTaxRateCode,
  buildTaxRateInUseMessage,
  createTaxRateSchema,
  updateTaxRateSchema,
} from "./taxRates.schemas";
import { resetMockTaxRates } from "./taxRates.testing";

const OTHER_STORE_ID = "00000000-0000-4000-8000-000000000002";

describe("taxRates.mock-server", () => {
  beforeEach(() => {
    resetMockTaxRates();
  });

  it("siembra exento 0, reducida 8 y general 16 como globales", () => {
    expect(listTaxRates(DEFAULT_STORE_ID).items.map((rate) => [rate.code, rate.pct, rate.isGlobal])).toEqual([
      ["exento", 0, true],
      ["reducida", 8, true],
      ["general", 16, true],
    ]);
  });

  it("no muta la semilla: el catalogo vivo es una copia", () => {
    createTaxRate({ label: "Lujo", pct: 31 }, DEFAULT_STORE_ID);
    updateTaxRate("tax-reducida", { isActive: false }, DEFAULT_STORE_ID);

    expect(mockTaxRates).toHaveLength(3);
    expect(mockTaxRates.every((rate) => rate.isActive && rate.storeId === null)).toBe(true);
  });

  it("la fila de la tienda manda sobre la global del mismo code solo en esa tienda", () => {
    const override = updateTaxRate("tax-general", { pct: 12 }, DEFAULT_STORE_ID);

    expect(mockTaxRatesForStore(DEFAULT_STORE_ID).filter((rate) => rate.code === "general")).toEqual([
      expect.objectContaining({ id: override.id, pct: 12, storeId: DEFAULT_STORE_ID }),
    ]);
    expect(findActiveMockTaxRateByCode(OTHER_STORE_ID, "general")).toEqual(
      expect.objectContaining({ id: "tax-general", pct: 16 }),
    );
    expect(findMockTaxRateForPct(DEFAULT_STORE_ID, 16, true)).toBeUndefined();
    expect(findMockTaxRateForPct(DEFAULT_STORE_ID, 12, true)?.code).toBe("general");
  });

  it("entre dos alicuotas del mismo porcentaje gana la activa y despues el orden", () => {
    const second = createTaxRate({ label: "General bis", pct: 16 }, DEFAULT_STORE_ID);

    expect(findMockTaxRateForPct(DEFAULT_STORE_ID, 16, true)?.code).toBe("general");

    updateTaxRate(second.id, { sortOrder: 1 }, DEFAULT_STORE_ID);
    expect(findMockTaxRateForPct(DEFAULT_STORE_ID, 16, true)?.code).toBe("general-bis");

    updateTaxRate(second.id, { isActive: false }, DEFAULT_STORE_ID);
    expect(findMockTaxRateForPct(DEFAULT_STORE_ID, 16, false)?.code).toBe("general");
  });

  it("redondea el porcentaje a dos decimales como numeric(5,2)", () => {
    expect(createTaxRate({ label: "Raro", pct: 12.345 }, DEFAULT_STORE_ID).pct).toBe(12.35);
  });

  it("cambiar el porcentaje de la alicuota por defecto actualiza la configuracion", () => {
    const exento = updateTaxRate("tax-exento", { pct: 1 }, DEFAULT_STORE_ID);

    expect(exento.isDefault).toBe(true);
    expect(getSettings(DEFAULT_STORE_ID)).toEqual(
      expect.objectContaining({ defaultTaxRate: 1, defaultTaxRateId: exento.id }),
    );

    updateTaxRate(exento.id, { pct: 2 }, DEFAULT_STORE_ID);
    expect(mockAppSettings.defaultTaxRate).toBe(2);
  });

  describe("categorias mock", () => {
    it("cada categoria sembrada tiene un taxRateId coherente con su taxRate", () => {
      const rates = new Map(mockTaxRates.map((rate) => [rate.id, rate.pct]));

      expect(mockCategories.length).toBeGreaterThan(0);
      for (const category of mockCategories) {
        expect(rates.get(category.taxRateId ?? "")).toBe(category.taxRate);
      }
      expect(rates.get(mockAppSettings.defaultTaxRateId ?? "")).toBe(mockAppSettings.defaultTaxRate);
    });

    it("exponen taxRateId al listar y al leer", () => {
      const { items } = listCategories(new URLSearchParams("isActive=all"), DEFAULT_STORE_ID);

      expect(items.map((category) => category.taxRateId)).toEqual([
        "tax-general",
        "tax-general",
        "tax-general",
        "tax-general",
        "tax-exento",
      ]);
      expect(getCategoryById("cat-tools", DEFAULT_STORE_ID).taxRateId).toBe("tax-general");
    });

    it("cambiar taxRate mueve taxRateId a la alicuota de ese porcentaje", () => {
      expect(updateCategory("cat-tools", { taxRate: 8 }, DEFAULT_STORE_ID)).toEqual(
        expect.objectContaining({ taxRate: 8, taxRateId: "tax-reducida" }),
      );
      expect(createCategory({ name: "Nueva", taxRate: 0 }, DEFAULT_STORE_ID)).toEqual(
        expect.objectContaining({ taxRate: 0, taxRateId: "tax-exento" }),
      );
      expect(createCategory({ name: "Nueva sin alicuota indicada" }, DEFAULT_STORE_ID)).toEqual(
        expect.objectContaining({ taxRate: 16, taxRateId: "tax-general" }),
      );
    });

    it("un porcentaje sin alicuota se rechaza con 400 y no cambia nada (como el trigger)", () => {
      expect(() =>
        updateCategory("cat-tools", { name: "Otra", taxRate: 13 }, DEFAULT_STORE_ID),
      ).toThrow(
        expect.objectContaining({
          message:
            "No existe una alicuota de IVA de 13 %: elige una del catalogo o creala en Configuracion",
          status: 400,
        }),
      );
      expect(getCategoryById("cat-tools", DEFAULT_STORE_ID)).toEqual(
        expect.objectContaining({ name: "Herramientas", taxRate: 16, taxRateId: "tax-general" }),
      );
      expect(() => createCategory({ name: "Nueva", taxRate: 13 }, DEFAULT_STORE_ID)).toThrow(
        expect.objectContaining({ status: 400 }),
      );
    });
  });
});

describe("taxRates.schemas", () => {
  it.each([
    ["General", "general"],
    ["  Súper Lujo 31 %  ", "super-lujo-31"],
    ["IVA 12,5%", "iva-12-5"],
    ["%%%", ""],
    [`${"a".repeat(39)} b`, "a".repeat(39)],
  ])("genera el code de %p", (label, code) => {
    expect(buildTaxRateCode(label)).toBe(code);
  });

  it("los codes generados cumplen el formato de la base", () => {
    for (const label of ["General", "Súper Lujo 31 %", "IVA 12,5%", "a - b . c"]) {
      expect(createTaxRateSchema.safeParse({ code: buildTaxRateCode(label), label, pct: 1 }).success).toBe(
        true,
      );
    }
  });

  it("no admite code ni storeId en un cambio", () => {
    expect(updateTaxRateSchema.safeParse({ label: "Lujo" }).success).toBe(true);
    expect(updateTaxRateSchema.safeParse({ code: "otro", label: "Lujo" }).success).toBe(false);
    expect(updateTaxRateSchema.safeParse({ label: "Lujo", storeId: "x" }).success).toBe(false);
    expect(updateTaxRateSchema.safeParse({}).success).toBe(false);
  });

  it("solo hay motivo de bloqueo si la alicuota esta en uso", () => {
    expect(buildTaxRateInUseMessage("General", 0, false)).toBeNull();
    expect(buildTaxRateInUseMessage("General", 2, true)).toBe(
      'No se puede desactivar la alicuota "General": la usan 2 categorias activas y es la alicuota por defecto de la tienda. Reasigna esas categorias y elige otra por defecto antes de desactivarla.',
    );
  });
});
