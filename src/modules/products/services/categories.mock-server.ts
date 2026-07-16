import { assertMockStoreResource } from "@/lib/api/assertStoreResource";
import { paginateList } from "@/lib/api/pagination";
import { mockCategories, type CategoryMock } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

export type CategoryInput = Partial<Pick<CategoryMock, "description" | "isActive" | "name">>;

export function listCategories(searchParams: URLSearchParams, storeId: string) {
  const search = searchParams.get("search")?.toLowerCase();
  const isActive = searchParams.get("isActive");

  const items = mockCategories.filter((category) => {
    const matchesSearch = !search || category.name.toLowerCase().includes(search);
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
  return {
    description: input.description,
    id: `cat-mock-${Date.now()}`,
    isActive: input.isActive ?? true,
    name: input.name ?? "Categoria mock",
    storeId,
  } satisfies CategoryMock;
}

export function updateCategory(id: string, input: CategoryInput, storeId: string) {
  const category = getCategoryById(id, storeId);

  if (input.description !== undefined) category.description = input.description;
  if (input.isActive !== undefined) category.isActive = input.isActive;
  if (input.name !== undefined) category.name = input.name;

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
