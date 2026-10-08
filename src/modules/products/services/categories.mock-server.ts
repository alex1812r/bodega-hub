import { ApiError } from "@/lib/api/apiError";
import { assertMockStoreResource } from "@/lib/api/assertStoreResource";
import { paginateList } from "@/lib/api/pagination";
import { resolveMockCategoryTaxRate } from "@/modules/settings/services/taxRates.mock-server";
import { mockCategories, type CategoryMock } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { parseCategoryDefaultMarkupPct } from "./categorySchemas";
import { isUnsearchableSearchTerm, normalizeProductSearch } from "./productSearch";

/** `defaultMarkupPct: null` borra el % sugerido; sin el campo, no se toca. */
export type CategoryInput = Partial<
  Pick<CategoryMock, "defaultMarkupPct" | "description" | "isActive" | "name" | "taxRate">
>;

let lastMockCategorySequence = 0;

/**
 * Indice unico `uq_categories_store_name_active` (store_id, name) where is_active:
 * nombre exacto (distingue mayusculas y espacios), por tienda y solo entre
 * activas. El servidor responde al 23505 con este mismo 409.
 */
function assertActiveNameIsFree(name: string, storeId: string, ignoredId?: string) {
  const isTaken = mockCategories.some(
    (category) =>
      category.id !== ignoredId &&
      category.isActive &&
      category.name === name &&
      (category.storeId ?? DEFAULT_STORE_ID) === storeId,
  );

  if (isTaken) {
    throw new ApiError(409, "CONFLICT", "El recurso ya existe.");
  }
}

export function listCategories(searchParams: URLSearchParams, storeId: string) {
  const search = normalizeProductSearch(searchParams.get("search")).toLowerCase();
  // Como en el servicio real: un término de solo comodines no casa con nada.
  const unsearchable = isUnsearchableSearchTerm(searchParams.get("search"));
  const isActive = searchParams.get("isActive");

  const items = mockCategories.filter((category) => {
    const matchesSearch =
      !unsearchable && (!search || category.name.toLowerCase().includes(search));
    const matchesActive =
      isActive === null
        ? category.isActive
        : isActive.toLowerCase() === "all" ||
          category.isActive === (isActive.toLowerCase() === "true");

    return (category.storeId ?? DEFAULT_STORE_ID) === storeId && matchesSearch && matchesActive;
  });

  return paginateList(items, searchParams);
}

export function getCategoryById(id: string, storeId: string) {
  const category = mockCategories.find((item) => item.id === id);
  assertMockStoreResource(category, storeId, "Categoria no encontrada.");

  return category;
}

export function createCategory(input: CategoryInput, storeId: string) {
  // Como el trigger de la base: el porcentaje debe ser el de una alicuota de la tienda.
  const taxRate = resolveMockCategoryTaxRate(storeId, input.taxRate ?? 16);
  const defaultMarkupPct = parseCategoryDefaultMarkupPct(input.defaultMarkupPct);
  const name = input.name ?? "Categoria mock";
  const isActive = input.isActive ?? true;

  if (isActive) {
    assertActiveNameIsFree(name, storeId);
  }

  lastMockCategorySequence += 1;

  const category: CategoryMock = {
    ...(defaultMarkupPct != null ? { defaultMarkupPct } : {}),
    description: input.description,
    id: `cat-mock-${Date.now()}-${lastMockCategorySequence}`,
    isActive,
    name,
    storeId,
    taxRate: taxRate.pct,
    taxRateId: taxRate.id,
  };

  mockCategories.push(category);

  return category;
}

export function updateCategory(id: string, input: CategoryInput, storeId: string) {
  const category = getCategoryById(id, storeId);
  // Se resuelve antes de escribir nada: un porcentaje sin alicuota rechaza el cambio entero.
  const taxRate =
    input.taxRate !== undefined && input.taxRate !== category.taxRate
      ? resolveMockCategoryTaxRate(storeId, input.taxRate)
      : undefined;
  const defaultMarkupPct = parseCategoryDefaultMarkupPct(input.defaultMarkupPct);

  if (input.isActive ?? category.isActive) {
    assertActiveNameIsFree(input.name ?? category.name, storeId, id);
  }

  if (defaultMarkupPct === null) delete category.defaultMarkupPct;
  if (typeof defaultMarkupPct === "number") category.defaultMarkupPct = defaultMarkupPct;
  if (input.description !== undefined) category.description = input.description;
  if (input.isActive !== undefined) category.isActive = input.isActive;
  if (input.name !== undefined) category.name = input.name;
  if (taxRate) {
    category.taxRate = taxRate.pct;
    category.taxRateId = taxRate.id;
  }

  return getCategoryById(id, storeId);
}

export function deleteCategory(id: string, storeId: string) {
  const category = getCategoryById(id, storeId);
  category.isActive = false;

  return {
    ...getCategoryById(id, storeId),
    deleted: true,
  };
}
