import type {
  ProductPackComponentMock,
  ProductPackConversionComponent,
  ProductPackConversionLinkedProduct,
  ProductPackConversionMock,
  ProductPackConversionSource,
  ProductPackConversionSummary,
} from "@/shared/mocks/erp-data";

/** Un producto tal como lo necesita el resumen de una receta. */
export type PackRecipeProduct = ProductPackConversionLinkedProduct & { isActive: boolean };

/** Una receta activa (cabecera + componentes) con sus productos ya resueltos. */
export type PackRecipeView = {
  components: { costWeight: number; product: PackRecipeProduct; unitsPerPack: number }[];
  id: string;
  label: string | null;
  packProduct: PackRecipeProduct;
  totalUnits: number;
};

export type PackConversionListItem = ProductPackConversionSummary & {
  packProduct: ProductPackConversionLinkedProduct;
};

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function toLinkedProduct(product: PackRecipeProduct): ProductPackConversionLinkedProduct {
  return {
    currentCostRef: product.currentCostRef,
    currentStock: product.currentStock,
    id: product.id,
    name: product.name,
    salePriceRef: product.salePriceRef,
    sku: product.sku,
  };
}

/** Componentes por nombre (y por id si se repite el nombre): orden estable del contrato. */
function sortedComponents(recipe: PackRecipeView) {
  return [...recipe.components].sort(
    (left, right) =>
      compareText(left.product.name, right.product.name) ||
      compareText(left.product.id, right.product.id),
  );
}

function toComponents(recipe: PackRecipeView): ProductPackConversionComponent[] {
  return sortedComponents(recipe).map((component) => ({
    costWeight: component.costWeight,
    currentStock: component.product.currentStock,
    isActive: component.product.isActive,
    name: component.product.name,
    sku: component.product.sku,
    unitProductId: component.product.id,
    unitsPerPack: component.unitsPerPack,
  }));
}

function recipeFields(recipe: PackRecipeView) {
  return {
    components: toComponents(recipe),
    id: recipe.id,
    kind: recipe.components.length > 1 ? ("assorted" as const) : ("single" as const),
    label: recipe.label,
    totalUnits: recipe.totalUnits,
  };
}

/**
 * Resumen de empaque de un producto a partir de sus recetas activas:
 * `packRecipe` = la receta de la que es empaque (a lo sumo una) y `sourceRecipes`
 * = las recetas de las que es componente (cualquier número).
 *
 * Con un solo vínculo los campos de siempre valen lo de siempre. Con varios:
 * - es empaque (aunque además salga de otros): `role: "pack"`, `linkedProduct` =
 *   su primer componente por nombre, `unitsPerPack` = total de unidades;
 * - solo es componente: `role: "unit"` y los campos de siempre describen la
 *   primera receta por nombre del empaque (`unitsPerPack` = unidades de este
 *   producto en ella). `sources` las trae todas.
 */
export function buildPackConversionSummary(params: {
  packRecipe?: PackRecipeView;
  productId: string;
  sourceRecipes: PackRecipeView[];
}): ProductPackConversionSummary | undefined {
  const sources: ProductPackConversionSource[] = params.sourceRecipes
    .flatMap((recipe) => {
      const component = recipe.components.find((item) => item.product.id === params.productId);

      return component
        ? [
            {
              conversionId: recipe.id,
              packName: recipe.packProduct.name,
              packProductId: recipe.packProduct.id,
              totalUnits: recipe.totalUnits,
              unitsPerPack: component.unitsPerPack,
            },
          ]
        : [];
    })
    .sort(
      (left, right) =>
        compareText(left.packName, right.packName) ||
        compareText(left.conversionId, right.conversionId),
    );

  if (params.packRecipe) {
    const firstComponent = sortedComponents(params.packRecipe)[0];

    if (!firstComponent) {
      return undefined;
    }

    return {
      ...recipeFields(params.packRecipe),
      linkedProduct: toLinkedProduct(firstComponent.product),
      role: "pack",
      sources,
      unitsPerPack: params.packRecipe.totalUnits,
    };
  }

  const firstSource = sources[0];
  const firstRecipe = params.sourceRecipes.find((recipe) => recipe.id === firstSource?.conversionId);

  if (!firstSource || !firstRecipe) {
    return undefined;
  }

  return {
    ...recipeFields(firstRecipe),
    linkedProduct: toLinkedProduct(firstRecipe.packProduct),
    role: "unit",
    sources,
    unitsPerPack: firstSource.unitsPerPack,
  };
}

/** Una receta en el listado de empaques que se pueden abrir (`role: "pack"`). */
export function buildPackConversionListItem(recipe: PackRecipeView): PackConversionListItem | null {
  const summary = buildPackConversionSummary({
    packRecipe: recipe,
    productId: recipe.packProduct.id,
    sourceRecipes: [],
  });

  return summary ? { ...summary, packProduct: toLinkedProduct(recipe.packProduct) } : null;
}

/**
 * Receta del mock con sus columnas de compatibilidad al día, como las mantiene
 * el trigger de la cabecera: `unitsPerPack` = `totalUnits`; `unitProductId` = el
 * componente único, o `null` en un surtido.
 */
export function buildMockPackRecipe(params: {
  components: ProductPackComponentMock[];
  id: string;
  isActive: boolean;
  label?: string | null;
  packProductId: string;
  storeId: string;
  totalUnits: number;
}): ProductPackConversionMock {
  return {
    components: params.components.map((component) => ({ ...component })),
    id: params.id,
    isActive: params.isActive,
    label: params.label ?? null,
    packProductId: params.packProductId,
    storeId: params.storeId,
    totalUnits: params.totalUnits,
    unitProductId: params.components.length === 1 ? params.components[0].unitProductId : null,
    unitsPerPack: params.totalUnits,
  };
}

/** Misma receta: mismos productos con las mismas unidades y pesos, y el mismo total. */
export function isSamePackRecipe(
  current: { components: ProductPackComponentMock[]; totalUnits: number },
  next: { components: ProductPackComponentMock[]; totalUnits: number },
) {
  return (
    current.totalUnits === next.totalUnits &&
    current.components.length === next.components.length &&
    next.components.every((component) =>
      current.components.some(
        (item) =>
          item.unitProductId === component.unitProductId &&
          item.unitsPerPack === component.unitsPerPack &&
          item.costWeight === component.costWeight,
      ),
    )
  );
}
