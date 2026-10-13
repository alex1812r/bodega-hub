/**
 * Efecto de abrir un empaque surtido con un reparto concreto: qué sale del
 * empaque, qué entra a cada componente y con qué stock queda cada uno. Lo pintan
 * la distribución editable y la confirmación de la apertura. Sin React: solo
 * aritmética sobre la receta (`packConversion` del BFF) y lo que tecleó el usuario.
 */

export type PackOpeningRecipeComponent = {
  currentStock: number;
  isActive: boolean;
  name: string;
  sku: string;
  unitProductId: string;
  unitsPerPack: number;
};

export type PackOpeningRecipe = {
  components: PackOpeningRecipeComponent[];
  pack: { currentStock: number; name: string };
};

/** Unidades por id de producto componente. Un componente que falta cuenta 0. */
export type PackOpeningDistribution = Record<string, number>;

export type PackOpeningIssue =
  /** La cantidad de empaques no es un entero mayor a cero. */
  | "invalid_quantity"
  /** Se abren más empaques de los que hay: el empaque quedaría en negativo. */
  | "pack_negative"
  /** Algún componente tiene unidades negativas o con decimales. */
  | "invalid_units"
  /** El reparto no suma `total por empaque × empaques`. */
  | "sum_mismatch";

export type PackOpeningStockChange = {
  delta: number;
  stockAfter: number;
  stockBefore: number;
};

export type PackOpeningComponentEffect = PackOpeningStockChange & {
  isActive: boolean;
  /** `false` si las unidades son negativas o no enteras. */
  isValidUnits: boolean;
  name: string;
  sku: string;
  unitProductId: string;
  units: number;
};

export type PackOpeningEffect = {
  /** En el orden de la receta. */
  components: PackOpeningComponentEffect[];
  /** Repartido − esperado: negativo = faltan unidades, positivo = sobran. */
  difference: number;
  distributedTotal: number;
  /** Total por empaque × empaques; 0 si la cantidad de empaques no es válida. */
  expectedTotal: number;
  isValid: boolean;
  issues: PackOpeningIssue[];
  pack: PackOpeningStockChange & { name: string };
  packQuantity: number;
};

function isPositiveInteger(value: number) {
  return Number.isInteger(value) && value > 0;
}

/** Reparto por receta: `unidades por empaque × empaques` de cada componente (0 si la cantidad no es válida). */
export function buildDefaultPackOpeningDistribution(
  components: Pick<PackOpeningRecipeComponent, "unitProductId" | "unitsPerPack">[],
  packQuantity: number,
): PackOpeningDistribution {
  const quantity = isPositiveInteger(packQuantity) ? packQuantity : 0;

  return Object.fromEntries(
    components.map((component) => [component.unitProductId, component.unitsPerPack * quantity]),
  );
}

/**
 * Calcula el efecto de la apertura. Los productos del reparto que no son de la
 * receta se ignoran (el formulario solo ofrece los de la receta). Con `issues`
 * no vacío la apertura no se puede confirmar.
 */
export function computePackOpeningEffect(input: {
  distribution: PackOpeningDistribution;
  packQuantity: number;
  recipe: PackOpeningRecipe;
}): PackOpeningEffect {
  const { distribution, recipe } = input;
  const packQuantity = Number.isFinite(input.packQuantity) ? input.packQuantity : 0;
  const isQuantityValid = isPositiveInteger(packQuantity);
  const unitsPerPackTotal = recipe.components.reduce(
    (total, component) => total + component.unitsPerPack,
    0,
  );

  const components = recipe.components.map((component): PackOpeningComponentEffect => {
    const typed = distribution[component.unitProductId] ?? 0;
    const units = Number.isFinite(typed) ? typed : 0;

    return {
      delta: units,
      isActive: component.isActive,
      isValidUnits: Number.isInteger(typed) && typed >= 0,
      name: component.name,
      sku: component.sku,
      stockAfter: component.currentStock + units,
      stockBefore: component.currentStock,
      unitProductId: component.unitProductId,
      units,
    };
  });

  const expectedTotal = isQuantityValid ? unitsPerPackTotal * packQuantity : 0;
  const distributedTotal = components.reduce((total, component) => total + component.units, 0);
  const packStockAfter = recipe.pack.currentStock - packQuantity;

  const issues: PackOpeningIssue[] = [];

  if (!isQuantityValid) {
    issues.push("invalid_quantity");
  }
  if (packStockAfter < 0) {
    issues.push("pack_negative");
  }
  if (components.some((component) => !component.isValidUnits)) {
    issues.push("invalid_units");
  }
  if (distributedTotal !== expectedTotal) {
    issues.push("sum_mismatch");
  }

  return {
    components,
    difference: distributedTotal - expectedTotal,
    distributedTotal,
    expectedTotal,
    isValid: issues.length === 0,
    issues,
    pack: {
      // Sin `-0` cuando no se abre nada.
      delta: packQuantity === 0 ? 0 : -packQuantity,
      name: recipe.pack.name,
      stockAfter: packStockAfter,
      stockBefore: recipe.pack.currentStock,
    },
    packQuantity,
  };
}

/**
 * `components` de `POST /api/inventory/conversions`: solo los que reciben
 * unidades (los 0 se omiten) y siempre por id de producto, para que el mismo
 * reparto produzca el mismo cuerpo y la clave de idempotencia lo reconozca.
 */
export function toPackOpeningRequestComponents(effect: Pick<PackOpeningEffect, "components">) {
  return effect.components
    .filter((component) => component.units > 0)
    .map((component) => ({ unitProductId: component.unitProductId, units: component.units }))
    .sort((left, right) =>
      left.unitProductId < right.unitProductId ? -1 : left.unitProductId > right.unitProductId ? 1 : 0,
    );
}
