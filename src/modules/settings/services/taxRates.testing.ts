import { mockAppSettings, mockCategories } from "@/shared/mocks/erp-data";

const registry = globalThis as typeof globalThis & {
  __bodegaHubMockState?: Map<string, unknown>;
};

const seedCategories = mockCategories.map((category) => ({ ...category }));
const seedSettings = { ...mockAppSettings };

/**
 * Solo para tests: devuelve a la semilla el catalogo mock de alicuotas, las
 * categorias (incluidas las altas, que persisten) y la configuracion con sus
 * ajustes de precios.
 */
export function resetMockTaxRates() {
  registry.__bodegaHubMockState?.delete("settings:taxRates");
  registry.__bodegaHubMockState?.delete("settings:pricing");
  mockCategories.splice(
    0,
    mockCategories.length,
    ...seedCategories.map((category) => ({ ...category })),
  );
  Object.assign(mockAppSettings, seedSettings);
}
