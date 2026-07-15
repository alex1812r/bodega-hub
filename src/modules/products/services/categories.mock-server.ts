import { ApiError } from "@/lib/api/apiError";
import { paginateList } from "@/lib/api/pagination";
import { mockCategories, type CategoryMock } from "@/shared/mocks/erp-data";

export type CategoryInput = Partial<Pick<CategoryMock, "description" | "isActive" | "name">>;

export function listCategories(searchParams: URLSearchParams) {
  const search = searchParams.get("search")?.toLowerCase();
  const isActive = searchParams.get("isActive");

  const items = mockCategories.filter((category) => {
    const matchesSearch = !search || category.name.toLowerCase().includes(search);
    const matchesActive =
      isActive === null
        ? category.isActive
        : isActive.toLowerCase() === "all" ||
          category.isActive === (isActive.toLowerCase() === "true");

    return matchesSearch && matchesActive;
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
    isActive: input.isActive ?? true,
    name: input.name ?? "Categoria mock",
  } satisfies CategoryMock;
}

export function updateCategory(id: string, input: CategoryInput) {
  const category = getCategoryById(id);

  if (input.description !== undefined) category.description = input.description;
  if (input.isActive !== undefined) category.isActive = input.isActive;
  if (input.name !== undefined) category.name = input.name;

  return getCategoryById(id);
}

export function deleteCategory(id: string) {
  const category = getCategoryById(id);
  category.isActive = false;

  return {
    ...getCategoryById(id),
    deleted: true,
  };
}
