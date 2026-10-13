import { ApiError } from "@/lib/api/apiError";
import {
  mockAppSettings,
  mockCategories,
  mockTaxRates,
  type TaxRateMock,
} from "@/shared/mocks/erp-data";
import { mockState } from "@/shared/mocks/mockStore";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import {
  TAX_RATE_CODE_NOT_DERIVABLE_MESSAGE,
  TAX_RATE_NOT_FOUND_MESSAGE,
  buildTaxRateCode,
  buildTaxRateCodeTakenMessage,
  buildTaxRateInUseMessage,
  compareTaxRates,
  nextTaxRateSortOrder,
  normalizeTaxRatePct,
  type CreateTaxRateInput,
  type TaxRate,
  type TaxRateList,
  type TaxRateListFilters,
  type UpdateTaxRateInput,
} from "./taxRates.schemas";

/** Catalogo en memoria (semilla global + alicuotas creadas por las tiendas). */
function taxRateRows() {
  return mockState<TaxRateMock[]>("settings:taxRates", () =>
    mockTaxRates.map((rate) => ({ ...rate })),
  );
}

/** `mockAppSettings` es la configuracion de la tienda demo. */
function ownsMockSettings(storeId: string) {
  return (mockAppSettings.storeId ?? DEFAULT_STORE_ID) === storeId;
}

function isDefaultTaxRate(storeId: string, taxRateId: string) {
  return ownsMockSettings(storeId) && mockAppSettings.defaultTaxRateId === taxRateId;
}

function storeCategories(storeId: string) {
  return mockCategories.filter((category) => (category.storeId ?? DEFAULT_STORE_ID) === storeId);
}

function toTaxRate(row: TaxRateMock, storeId: string): TaxRate {
  return {
    code: row.code,
    id: row.id,
    isActive: row.isActive,
    isDefault: isDefaultTaxRate(storeId, row.id),
    isGlobal: row.storeId === null,
    label: row.label,
    pct: row.pct,
    sortOrder: row.sortOrder,
  };
}

/**
 * Alicuotas vigentes para una tienda, como `tax_rates_for_store`: las suyas mas
 * las globales cuyo `code` no haya redefinido.
 */
export function mockTaxRatesForStore(storeId: string) {
  const rows = taxRateRows();
  const own = rows.filter((row) => row.storeId === storeId);

  return [
    ...own,
    ...rows.filter(
      (row) => row.storeId === null && !own.some((ownRow) => ownRow.code === row.code),
    ),
  ];
}

/** Alicuota ACTIVA de la tienda con ese `code` (regla de `create_purchase`). */
export function findActiveMockTaxRateByCode(storeId: string, code: string) {
  return mockTaxRatesForStore(storeId).find((row) => row.code === code && row.isActive);
}

/** Como `tax_rate_for_pct`: activa primero, despues `sortOrder`, `code` e `id`. */
export function findMockTaxRateForPct(storeId: string, pct: number, onlyActive: boolean) {
  const target = normalizeTaxRatePct(pct);

  return mockTaxRatesForStore(storeId)
    .filter((row) => row.pct === target && (row.isActive || !onlyActive))
    .sort(
      (first, second) =>
        Number(second.isActive) - Number(first.isActive) ||
        first.sortOrder - second.sortOrder ||
        first.code.localeCompare(second.code) ||
        first.id.localeCompare(second.id),
    )[0];
}

/**
 * Lo que hace el trigger `categories_sync_tax_rate` cuando solo llega el
 * porcentaje: alicuota de la tienda con ese pct, o 400 si no existe ninguna.
 */
export function resolveMockCategoryTaxRate(storeId: string, pct: number) {
  const rate = findMockTaxRateForPct(storeId, pct, false);

  if (!rate) {
    throw new ApiError(
      400,
      "BAD_REQUEST",
      `No existe una alicuota de IVA de ${normalizeTaxRatePct(pct)} %: elige una del catalogo o creala en Configuracion`,
    );
  }

  return rate;
}

/** Trigger `tax_rates_propagate_pct`: el porcentaje se copia a quien usa la alicuota. */
function propagatePct(row: TaxRateMock) {
  for (const category of mockCategories) {
    if (category.taxRateId === row.id) {
      category.taxRate = row.pct;
    }
  }

  if (mockAppSettings.defaultTaxRateId === row.id) {
    mockAppSettings.defaultTaxRate = row.pct;
  }
}

function findGlobalByCode(code: string) {
  return taxRateRows().find((candidate) => candidate.storeId === null && candidate.code === code);
}

/**
 * La fila de la tienda manda sobre la global del mismo `code`: lo que en la
 * tienda apuntaba a la global pasa a apuntar a la fila propia.
 */
function adoptGlobalReferences(storeId: string, row: TaxRateMock, global: TaxRateMock | undefined) {
  if (!global) {
    return;
  }

  for (const category of storeCategories(storeId)) {
    if (category.taxRateId === global.id) {
      category.taxRateId = row.id;
      category.taxRate = row.pct;
    }
  }

  if (isDefaultTaxRate(storeId, global.id)) {
    mockAppSettings.defaultTaxRateId = row.id;
    mockAppSettings.defaultTaxRate = row.pct;
  }
}

/**
 * Regla 409 de `override_tax_rate_for_store`. La RPC la evalua despues de pasar
 * a la fila de la tienda lo que apuntaba a la global, y si rechaza deshace todo;
 * aqui no hay transaccion, asi que se cuenta ANTES de tocar nada lo que usa la
 * alicuota o la global de su mismo `code`.
 */
function assertCanDeactivate(storeId: string, row: TaxRateMock, global: TaxRateMock | undefined) {
  const ids = [row.id, ...(global ? [global.id] : [])];
  const message = buildTaxRateInUseMessage(
    row.label,
    storeCategories(storeId).filter(
      (category) => category.isActive && ids.includes(category.taxRateId ?? ""),
    ).length,
    ids.some((id) => isDefaultTaxRate(storeId, id)),
  );

  if (message) {
    throw new ApiError(409, "CONFLICT", message);
  }
}

export function listTaxRates(storeId: string, filters: TaxRateListFilters = {}): TaxRateList {
  return {
    items: mockTaxRatesForStore(storeId)
      .filter((row) => !filters.activeOnly || row.isActive)
      .map((row) => toTaxRate(row, storeId))
      .sort(compareTaxRates),
  };
}

export function createTaxRate(input: CreateTaxRateInput, storeId: string): TaxRate {
  const visible = mockTaxRatesForStore(storeId);
  const code = input.code ?? buildTaxRateCode(input.label);

  if (!code) {
    throw new ApiError(400, "BAD_REQUEST", TAX_RATE_CODE_NOT_DERIVABLE_MESSAGE);
  }

  if (visible.some((row) => row.code === code)) {
    throw new ApiError(409, "CONFLICT", buildTaxRateCodeTakenMessage(code));
  }

  const rows = taxRateRows();
  const row: TaxRateMock = {
    code,
    id: `tax-mock-${rows.length + 1}-${Date.now()}`,
    isActive: true,
    label: input.label,
    pct: normalizeTaxRatePct(input.pct),
    sortOrder: nextTaxRateSortOrder(visible),
    storeId,
  };

  rows.push(row);

  return toTaxRate(row, storeId);
}

/**
 * Mismo comportamiento que la RPC `override_tax_rate_for_store` (parche
 * 20261007b): o se aplica todo el cambio o no cambia nada.
 */
export function updateTaxRate(id: string, input: UpdateTaxRateInput, storeId: string): TaxRate {
  // Solo lo que ve la tienda: la alicuota de otra tienda, o una global que la
  // tienda ya redefinio, no existe para ella.
  const current = mockTaxRatesForStore(storeId).find((row) => row.id === id);

  if (!current) {
    throw new ApiError(404, "NOT_FOUND", TAX_RATE_NOT_FOUND_MESSAGE);
  }

  const next = {
    isActive: input.isActive ?? current.isActive,
    label: input.label ?? current.label,
    pct: input.pct === undefined ? current.pct : normalizeTaxRatePct(input.pct),
    sortOrder: input.sortOrder ?? current.sortOrder,
  };
  const isGlobal = current.storeId === null;
  const global = isGlobal ? current : findGlobalByCode(current.code);

  if (
    isGlobal &&
    next.isActive === current.isActive &&
    next.label === current.label &&
    next.pct === current.pct &&
    next.sortOrder === current.sortOrder
  ) {
    return toTaxRate(current, storeId);
  }

  if (current.isActive && !next.isActive) {
    assertCanDeactivate(storeId, current, global);
  }

  let row = current;

  if (isGlobal) {
    // Las globales no se escriben: la tienda recibe su propia fila con el mismo code.
    const rows = taxRateRows();

    row = { ...current, id: `tax-mock-${rows.length + 1}-${Date.now()}`, storeId };
    rows.push(row);
  }

  adoptGlobalReferences(storeId, row, global);
  Object.assign(row, next);
  propagatePct(row);

  return toTaxRate(row, storeId);
}
