import type { CategoryMock } from "@/shared/mocks/erp-data";

export function resolveCategoryIdByName(
  categoryName: string | undefined,
  categories: CategoryMock[],
): { categoryId?: string; error?: string } {
  const trimmed = categoryName?.trim();

  if (!trimmed) {
    return {};
  }

  const match = categories.find(
    (category) => category.name.localeCompare(trimmed, undefined, { sensitivity: "accent" }) === 0,
  );

  if (!match) {
    return {
      error: `La categoria "${trimmed}" no existe. Seleccione un valor del listado de la plantilla.`,
    };
  }

  return { categoryId: match.id };
}
