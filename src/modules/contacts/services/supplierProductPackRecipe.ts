import { ApiError } from "@/lib/api/apiError";

/**
 * Tamaños que la receta del producto admite para un empaque del proveedor:
 * los mismos con los que `create_purchase` valida una línea en modo empaque
 * (20261010d, PRO-12). Sin receta, `null`: vale cualquier tamaño > 0.
 * - `component`: el producto es el ÚNICO componente de recetas activas
 *   (`units_per_pack = total_units`); vale cualquiera de esos tamaños.
 * - `pack`: el producto ES el empaque de una receta activa; vale su total.
 * Como en la RPC, el lado componente manda sobre el lado empaque.
 */
export type PackRecipeRule = { kind: "component" | "pack"; sizes: number[] } | null;

export type PackRecipeSources = {
  /** Tamaños de las recetas activas de las que el producto es componente único. */
  componentSizes: number[];
  /** `total_units` de la receta activa cuyo empaque es el producto, si la hay. */
  packTotalUnits?: number | null;
};

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function resolvePackRecipeRule({ componentSizes, packTotalUnits }: PackRecipeSources): PackRecipeRule {
  const sizes = [...new Set(componentSizes.filter(isPositiveNumber))].sort((a, b) => a - b);

  if (sizes.length > 0) {
    return { kind: "component", sizes };
  }

  return isPositiveNumber(packTotalUnits) ? { kind: "pack", sizes: [packTotalUnits] } : null;
}

/** "o" pasa a "u" ante un número que se pronuncia empezando por "o" (8, 11, 80…). */
function joinSizes(sizes: number[]) {
  return sizes.reduce((text, size, index) => {
    if (index === 0) return String(size);
    const conjunction = /^8/.test(String(size)) || size === 11 ? "u" : "o";
    return `${text}${index === sizes.length - 1 ? ` ${conjunction} ` : ", "}${size}`;
  }, "");
}

export function packRecipeMismatchMessage(rule: NonNullable<PackRecipeRule>, unitsPerPack: number) {
  if (rule.kind === "pack") {
    return `Este producto es un empaque de ${rule.sizes[0]} unidades según su receta; ${unitsPerPack} no coincide con la receta.`;
  }

  if (rule.sizes.length === 1) {
    return `Este producto se arma en empaques de ${rule.sizes[0]} unidades; ${unitsPerPack} no coincide con la receta.`;
  }

  return `Este producto se arma en empaques de ${joinSizes(rule.sizes)} unidades; ${unitsPerPack} no coincide con ninguna receta.`;
}

/** 400 si el producto tiene receta y el tamaño no es uno de los que admite. */
export function assertPackSizeMatchesRecipe(rule: PackRecipeRule, unitsPerPack: number) {
  if (rule && !rule.sizes.includes(unitsPerPack)) {
    throw new ApiError(400, "BAD_REQUEST", packRecipeMismatchMessage(rule, unitsPerPack));
  }
}
