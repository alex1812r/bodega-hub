import type { ProductEntityOption } from "@/shared/components/EntityAutocomplete";

import type { PackConversionListItem } from "../../hooks/useInventory";
import { isAssortedOpening } from "./packOpeningText";

/**
 * Búsqueda del campo "Producto empaque". La fuente son las recetas activas
 * (`GET /api/inventory/pack-conversions`): es el único endpoint que dice qué
 * productos son empaque y con qué receta, y no admite búsqueda ni paginación.
 */

function normalize(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function toPackOption({ packProduct }: PackConversionListItem): ProductEntityOption {
  return {
    barcode: null,
    categoryId: "",
    currentCostRef: packProduct.currentCostRef,
    currentStock: packProduct.currentStock,
    id: packProduct.id,
    // La lista solo trae recetas activas; el estado del producto no viaja en ella.
    isActive: true,
    label: packProduct.name,
    salePriceRef: packProduct.salePriceRef,
    sku: packProduct.sku,
  };
}

/** Empaques cuyo nombre o SKU contiene `query` (sin distinguir mayúsculas ni tildes), por nombre. */
export function searchPackOptions(
  recipes: PackConversionListItem[],
  query: string,
  limit: number,
): ProductEntityOption[] {
  const needle = normalize(query);

  return recipes
    .filter(
      ({ packProduct }) =>
        normalize(packProduct.name).includes(needle) || normalize(packProduct.sku).includes(needle),
    )
    .sort((left, right) => left.packProduct.name.localeCompare(right.packProduct.name, "es"))
    .slice(0, limit)
    .map(toPackOption);
}

/** "→ Cigarro suelto (x10)" o "→ surtido de 3 productos (x6)": en qué se abre el empaque. */
export function describePackRecipe(recipe: PackConversionListItem) {
  return isAssortedOpening(recipe)
    ? `→ surtido de ${recipe.components?.length} productos (x${recipe.unitsPerPack})`
    : `→ ${recipe.linkedProduct.name} (x${recipe.unitsPerPack})`;
}
