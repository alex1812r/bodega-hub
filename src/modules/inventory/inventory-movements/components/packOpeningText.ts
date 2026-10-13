import type { ToastOptions } from "@/shared/components/Toast";
import type { ProductPackConversionSummary } from "@/shared/mocks/erp-data";

import type { ConvertPackToUnitsResult } from "../../hooks/useInventory";

/**
 * Textos de abrir un empaque según su receta. Los comparten el modal de
 * Inventario y el del detalle del producto: lo que se va a abrir y lo que entró.
 */

type OpeningRecipe = Pick<
  ProductPackConversionSummary,
  "components" | "kind" | "linkedProduct"
>;

/** Lo que devuelve la conversión; `components` falta en servidores anteriores al surtido. */
type OpeningResult = Pick<ConvertPackToUnitsResult, "unitQuantity"> & {
  components?: Pick<ConvertPackToUnitsResult["components"][number], "isActive" | "unitProductId" | "units">[];
};

/** Receta surtida: varios productos. Un 1 a 1 conserva sus textos de siempre. */
export function isAssortedOpening(recipe: OpeningRecipe) {
  return recipe.kind === "assorted" && (recipe.components?.length ?? 0) > 1;
}

/** "6 Cola · 6 Manzana (inactivo) · 6 Naranja": lo que entra por receta al abrir `packQuantity` empaques. */
export function describeRecipeOpening(recipe: OpeningRecipe, packQuantity: number) {
  return (recipe.components ?? [])
    .map(
      (component) =>
        `${component.unitsPerPack * packQuantity} ${component.name}${component.isActive ? "" : " (inactivo)"}`,
    )
    .join(" · ");
}

/**
 * Aviso de una apertura correcta: "Abriste 3 Surtido A: +6 Cola, +6 Manzana".
 * Si entró stock a un producto inactivo lo dice en la descripción y el aviso no
 * se cierra solo: informa, no bloquea.
 */
export function buildPackOpeningToast(input: {
  packName: string;
  packQuantity: number;
  recipe: OpeningRecipe;
  result: OpeningResult;
}): ToastOptions {
  const { packName, packQuantity, recipe, result } = input;
  const names = new Map([
    [recipe.linkedProduct.id, recipe.linkedProduct.name],
    ...(recipe.components ?? []).map(
      (component) => [component.unitProductId, component.name] as const,
    ),
  ]);
  const entries = result.components?.length
    ? result.components
        .map((component) => ({
          inactive: component.isActive === false,
          name: names.get(component.unitProductId) ?? "otro producto",
          units: component.units,
        }))
        .sort((left, right) => left.name.localeCompare(right.name, "es"))
    : [{ inactive: false, name: recipe.linkedProduct.name, units: result.unitQuantity }];
  const inactive = entries.filter((entry) => entry.inactive).map((entry) => entry.name);
  const title = `Abriste ${packQuantity} ${packName}: ${entries
    .map((entry) => `+${entry.units} ${entry.name}`)
    .join(", ")}`;

  if (inactive.length === 0) {
    return { title, tone: "success" };
  }

  return {
    description:
      inactive.length === 1
        ? `Entró stock a un producto inactivo: ${inactive[0]}. Actívalo para poder venderlo.`
        : `Entró stock a productos inactivos: ${inactive.join(", ")}. Actívalos para poder venderlos.`,
    durationMs: 0,
    title,
    tone: "success",
  };
}
