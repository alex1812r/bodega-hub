import { ApiError } from "@/lib/api/apiError";
import { paginateList } from "@/lib/api/pagination";
import { mockCategories, type CategoryMock } from "@/shared/mocks/erp-data";

export type CategoryInput = Partial<Pick<CategoryMock, "description" | "name">>;

export function listCategories(searchParams: URLSearchParams) {
  const search = searchParams.get("search")?.toLowerCase();

  const items = mockCategories.filter((category) => {
    return !search || category.name.toLowerCase().includes(search);
  });

  return paginateList(items, searchParams);
}

export function getCategoryById(id: string) {
  const category = mockCategories.find((item) => item.id === id);

  if (!category) {
    throw new ApiError(404, "NOT_FOUND", "Categoria no encontrada.");
  }

  return category;
}

export function createCategory(input: CategoryInput) {
  return {
    description: input.description,
    id: `cat-mock-${Date.now()}`,
    name: input.name ?? "Categoria mock",
  } satisfies CategoryMock;
}

export function updateCategory(id: string, input: CategoryInput) {
  return {
    ...getCategoryById(id),
    ...input,
  };
}

export function deleteCategory(id: string) {
  const category = getCategoryById(id);

  return {
    ...category,
    deleted: true,
  };
}
