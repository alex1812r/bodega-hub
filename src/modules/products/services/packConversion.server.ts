import { type DbProductSummaryRow } from "@/lib/supabase/mappers";
import { mapSupabaseError, throwIfSupabaseError } from "@/lib/supabase/errors";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import type { ProductPackConversionSummary } from "@/shared/mocks/erp-data";
import { generateProductSkuFromName, normalizeSku } from "@/shared/utils/skuGeneration";

import type { PackConversionInput } from "./packConversionSchemas";
import {
  buildPackConversionListItem,
  buildPackConversionSummary,
  isSamePackRecipe,
  type PackRecipeProduct,
  type PackRecipeView,
} from "./packConversionSummary";
import { normalizeBarcode } from "./productSearch";
import type { ProductInput } from "./products.mock-server";
import { ApiError } from "@/lib/api/apiError";
import { assertSupabaseStoreResource } from "@/lib/api/assertStoreResource";

type RouteSupabaseClient = Awaited<ReturnType<typeof createRouteSupabaseClient>>;

const linkedProductSelect =
  "id, sku, name, sale_price_ref, current_cost_ref, current_stock, is_active";

/**
 * Receta completa: cabecera, empaque y componentes con su producto (parche
 * 20261009d). Una sola lectura trae todo: no hay consulta por componente.
 */
const recipeSelect = `
  id,
  pack_product_id,
  label,
  total_units,
  pack_product:products!pack_product_id(${linkedProductSelect}),
  components:product_pack_components(
    unit_product_id,
    units_per_pack,
    cost_weight,
    unit_product:products!unit_product_id(${linkedProductSelect})
  )
`;

type PackComponentRow = {
  cost_weight: number | string;
  unit_product?: DbProductSummaryRow | DbProductSummaryRow[] | null;
  unit_product_id: string;
  units_per_pack: number;
};

type PackRecipeRow = {
  components?: PackComponentRow[] | null;
  id: string;
  label?: string | null;
  pack_product?: DbProductSummaryRow | DbProductSummaryRow[] | null;
  pack_product_id: string;
  total_units: number;
};

type PackRecipeSourceRow = {
  conversion?: PackRecipeRow | PackRecipeRow[] | null;
};

function resolveEmbedded<T>(value: T | T[] | null | undefined): T | undefined {
  if (!value) {
    return undefined;
  }

  return Array.isArray(value) ? value[0] : value;
}

function mapRecipeProduct(row: DbProductSummaryRow): PackRecipeProduct {
  return {
    currentCostRef: Number(row.current_cost_ref ?? 0),
    currentStock: row.current_stock ?? 0,
    id: row.id,
    isActive: row.is_active ?? true,
    name: row.name,
    salePriceRef: Number(row.sale_price_ref ?? 0),
    sku: normalizeSku(row.sku),
  };
}

/** `undefined` si falta el empaque o algún producto componente (fila no visible). */
export function mapPackRecipeRow(row: PackRecipeRow): PackRecipeView | undefined {
  const pack = resolveEmbedded(row.pack_product);
  const components = (row.components ?? []).map((component) => ({
    component,
    product: resolveEmbedded(component.unit_product),
  }));

  if (!pack || components.length === 0 || components.some((item) => !item.product)) {
    return undefined;
  }

  return {
    components: components.flatMap(({ component, product }) =>
      product
        ? [
            {
              costWeight: Number(component.cost_weight),
              product: mapRecipeProduct(product),
              unitsPerPack: component.units_per_pack,
            },
          ]
        : [],
    ),
    id: row.id,
    label: row.label ?? null,
    packProduct: mapRecipeProduct(pack),
    totalUnits: row.total_units,
  };
}

/**
 * Vínculo de empaque de un producto: la receta de la que es empaque y TODAS las
 * recetas activas de las que sale como componente (un producto puede salir de
 * varios empaques). Dos lecturas en paralelo, sea cual sea el número de recetas.
 */
export async function getPackConversionForProduct(
  productId: string,
  storeId: string,
): Promise<ProductPackConversionSummary | undefined> {
  const supabase = await createRouteSupabaseClient();
  const [packResult, sourcesResult] = await Promise.all([
    // A lo sumo una fila: `uq_product_pack_conversions_pack_active`.
    supabase
      .from("product_pack_conversions")
      .select(recipeSelect)
      .eq("store_id", storeId)
      .eq("is_active", true)
      .eq("pack_product_id", productId)
      .maybeSingle(),
    supabase
      .from("product_pack_components")
      .select(`conversion:product_pack_conversions!inner(${recipeSelect})`)
      .eq("store_id", storeId)
      .eq("unit_product_id", productId)
      .eq("conversion.is_active", true),
  ]);

  throwIfSupabaseError(packResult.error);
  throwIfSupabaseError(sourcesResult.error);

  const packRecipe = packResult.data
    ? mapPackRecipeRow(packResult.data as unknown as PackRecipeRow)
    : undefined;
  const sourceRecipes = ((sourcesResult.data ?? []) as unknown as PackRecipeSourceRow[]).flatMap(
    (row) => {
      const conversion = resolveEmbedded(row.conversion);
      const recipe = conversion ? mapPackRecipeRow(conversion) : undefined;

      return recipe ? [recipe] : [];
    },
  );

  return buildPackConversionSummary({ packRecipe, productId, sourceRecipes });
}

export async function listPackConversions(storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("product_pack_conversions")
    .select(recipeSelect)
    .eq("store_id", storeId)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  throwIfSupabaseError(error);

  return ((data ?? []) as unknown as PackRecipeRow[]).flatMap((row) => {
    const recipe = mapPackRecipeRow(row);
    const item = recipe ? buildPackConversionListItem(recipe) : null;

    return item ? [item] : [];
  });
}

/**
 * Un producto unidad / componente puede salir de varios empaques. Lo que no se
 * admite es que sea él mismo el EMPAQUE de una receta activa (cadena de
 * empaques): regla del BFF, la base no la impone.
 */
async function assertUnitAvailable(
  unitProductId: string,
  storeId: string,
  packProductId: string,
) {
  await assertSupabaseStoreResource(
    "products",
    unitProductId,
    storeId,
    "Producto unidad no encontrado.",
  );

  if (unitProductId === packProductId) {
    throw new ApiError(400, "BAD_REQUEST", "El empaque y la unidad deben ser productos distintos.");
  }

  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("product_pack_conversions")
    .select("id")
    .eq("store_id", storeId)
    .eq("is_active", true)
    .eq("pack_product_id", unitProductId)
    .maybeSingle();

  throwIfSupabaseError(error);

  if (data) {
    throw new ApiError(
      409,
      "CONFLICT",
      "El producto unidad es un empaque con receta activa: no puede salir de otro empaque.",
    );
  }
}

/** Lo mismo que `assertUnitAvailable` para todos los componentes, en dos lecturas. */
async function assertComponentsAvailable(
  supabase: RouteSupabaseClient,
  unitProductIds: string[],
  storeId: string,
  packProductId: string,
) {
  if (unitProductIds.includes(packProductId)) {
    throw new ApiError(400, "BAD_REQUEST", "El empaque no puede ser componente de sí mismo.");
  }

  const { data: products, error: productsError } = await supabase
    .from("products")
    .select("id")
    .eq("store_id", storeId)
    .in("id", unitProductIds);

  throwIfSupabaseError(productsError);

  if ((products ?? []).length !== unitProductIds.length) {
    throw new ApiError(404, "NOT_FOUND", "Producto componente no encontrado.");
  }

  const { data: packs, error: packsError } = await supabase
    .from("product_pack_conversions")
    .select("pack_product_id")
    .eq("store_id", storeId)
    .eq("is_active", true)
    .in("pack_product_id", unitProductIds);

  throwIfSupabaseError(packsError);

  if ((packs ?? []).length > 0) {
    throw new ApiError(
      409,
      "CONFLICT",
      "Un componente es un empaque con receta activa: no puede salir de otro empaque.",
    );
  }
}

type ActiveRecipeRow = {
  components?: { cost_weight: number | string; unit_product_id: string; units_per_pack: number }[] | null;
  id: string;
  label?: string | null;
  total_units: number;
  unit_product_id: string | null;
};

/** La receta activa del empaque (a lo sumo una: `uq_product_pack_conversions_pack_active`). */
async function findActiveRecipe(
  supabase: RouteSupabaseClient,
  packProductId: string,
  storeId: string,
) {
  const { data, error } = await supabase
    .from("product_pack_conversions")
    .select(
      "id, unit_product_id, total_units, label, components:product_pack_components(unit_product_id, units_per_pack, cost_weight)",
    )
    .eq("store_id", storeId)
    .eq("pack_product_id", packProductId)
    .eq("is_active", true)
    .maybeSingle();

  throwIfSupabaseError(error);

  return (data as unknown as ActiveRecipeRow | null) ?? null;
}

async function setRecipeActive(supabase: RouteSupabaseClient, recipeId: string, isActive: boolean) {
  const { error } = await supabase
    .from("product_pack_conversions")
    .update({ is_active: isActive })
    .eq("id", recipeId);

  return error;
}

/**
 * Borra una receta que nunca llegó a activarse (sus componentes caen en cascada).
 * `is_active = false` en el filtro: nunca borra una receta en uso. Si el borrado
 * falla queda una cabecera inactiva, que no afecta a ninguna apertura.
 */
async function discardDraftRecipe(supabase: RouteSupabaseClient, recipeId: string, storeId: string) {
  await supabase
    .from("product_pack_conversions")
    .delete()
    .eq("id", recipeId)
    .eq("store_id", storeId)
    .eq("is_active", false);
}

/**
 * Tras fallar el último paso de un reemplazo, vuelve a activar la receta que
 * había. Si tampoco se puede, el error dice que el empaque quedó sin receta.
 */
async function restorePreviousRecipe(
  supabase: RouteSupabaseClient,
  previousRecipeId: string | undefined,
  failure: unknown,
): Promise<ApiError> {
  const mapped = mapSupabaseError(failure);

  if (!previousRecipeId) {
    return mapped;
  }

  const restoreError = await setRecipeActive(supabase, previousRecipeId, true);

  if (!restoreError) {
    return mapped;
  }

  return new ApiError(
    mapped.status,
    mapped.code,
    `${mapped.message} Además no se pudo restaurar la receta anterior: el empaque quedó sin receta activa. Guarda la receta de nuevo.`,
  );
}

/**
 * Guarda una receta surtida. PostgREST abre una transacción por petición y la
 * base exige que una receta ACTIVA cuadre al commit, así que el orden es el del
 * parche 20261009d: cabecera INACTIVA → componentes → (desactivar la anterior)
 * → activar. La receta nueva solo existe como activa tras el último paso, que es
 * una sola sentencia validada por la base: nunca queda una receta activa a medias.
 *
 * Una receta distinta de la vigente nunca se edita en sitio: se crea otra y la
 * anterior queda inactiva, para no convertir en `missing_link` las aperturas ya
 * registradas (`conversion_mismatches`).
 *
 * Sin transacción entre peticiones, se compensa: si falla antes de activar se
 * borra el borrador y la receta anterior sigue intacta; si falla la activación
 * se reactiva la anterior y se borra el borrador. Entre desactivar la anterior y
 * activar la nueva el empaque no tiene receta (una apertura simultánea recibe 404).
 */
async function saveAssortedRecipe(
  supabase: RouteSupabaseClient,
  packProductId: string,
  storeId: string,
  input: PackConversionInput,
) {
  const components = (input.components ?? []).map((component) => ({
    costWeight: component.costWeight,
    unitProductId: component.unitProductId,
    unitsPerPack: component.unitsPerPack,
  }));
  const totalUnits = input.totalUnits ?? 0;
  const label = input.label?.trim() || null;

  await assertComponentsAvailable(
    supabase,
    components.map((component) => component.unitProductId),
    storeId,
    packProductId,
  );

  const existing = await findActiveRecipe(supabase, packProductId, storeId);

  if (
    existing &&
    isSamePackRecipe(
      {
        components: (existing.components ?? []).map((component) => ({
          costWeight: Number(component.cost_weight),
          unitProductId: component.unit_product_id,
          unitsPerPack: component.units_per_pack,
        })),
        totalUnits: existing.total_units,
      },
      { components, totalUnits },
    )
  ) {
    if ((existing.label ?? null) !== label) {
      const { error } = await supabase
        .from("product_pack_conversions")
        .update({ label })
        .eq("id", existing.id);

      throwIfSupabaseError(error);
    }

    return;
  }

  const { data: draft, error: draftError } = await supabase
    .from("product_pack_conversions")
    .insert({
      is_active: false,
      label,
      pack_product_id: packProductId,
      store_id: storeId,
      total_units: totalUnits,
    })
    .select("id")
    .single();

  throwIfSupabaseError(draftError);

  if (!draft?.id) {
    throw new ApiError(500, "INTERNAL_ERROR", "No se pudo crear la receta del empaque.");
  }

  const { error: componentsError } = await supabase.from("product_pack_components").insert(
    components.map((component) => ({
      conversion_id: draft.id,
      cost_weight: component.costWeight,
      store_id: storeId,
      unit_product_id: component.unitProductId,
      units_per_pack: component.unitsPerPack,
    })),
  );

  if (componentsError) {
    await discardDraftRecipe(supabase, draft.id, storeId);
    throw mapSupabaseError(componentsError);
  }

  if (existing) {
    const deactivateError = await setRecipeActive(supabase, existing.id, false);

    if (deactivateError) {
      await discardDraftRecipe(supabase, draft.id, storeId);
      throw mapSupabaseError(deactivateError);
    }
  }

  const activateError = await setRecipeActive(supabase, draft.id, true);

  if (activateError) {
    const failure = await restorePreviousRecipe(supabase, existing?.id, activateError);
    await discardDraftRecipe(supabase, draft.id, storeId);
    throw failure;
  }
}

export async function upsertPackConversionForPackProduct(
  packProductId: string,
  storeId: string,
  input: PackConversionInput,
  packProduct?: ProductInput & { name?: string; categoryId?: string; currentCostRef?: number },
) {
  const supabase = await createRouteSupabaseClient();

  if (!input.enabled) {
    const { error } = await supabase
      .from("product_pack_conversions")
      .update({ is_active: false })
      .eq("store_id", storeId)
      .eq("pack_product_id", packProductId)
      .eq("is_active", true);

    throwIfSupabaseError(error);
    return;
  }

  if (input.mode === "assorted") {
    await saveAssortedRecipe(supabase, packProductId, storeId, input);
    return;
  }

  const unitsPerPack = input.unitsPerPack ?? 2;
  let unitProductId = input.unitProductId;

  if (input.mode === "link_existing") {
    if (!unitProductId) {
      throw new ApiError(400, "BAD_REQUEST", "Selecciona el producto unidad.");
    }

    await assertUnitAvailable(unitProductId, storeId, packProductId);
  } else {
    const unitName =
      input.unitProduct?.name?.trim() ||
      `${packProduct?.name ?? "Producto"} (unidad)`;
    const unitSku =
      normalizeSku(input.unitProduct?.sku ?? "") ||
      generateProductSkuFromName(unitName);
    const unitCost =
      input.unitProduct?.currentCostRef ??
      (packProduct?.currentCostRef != null
        ? Number((packProduct.currentCostRef / unitsPerPack).toFixed(2))
        : 0);

    const { data: unitRow, error: unitError } = await supabase
      .from("products")
      .insert({
        barcode: normalizeBarcode(input.unitProduct?.barcode),
        category_id: packProduct?.categoryId ?? null,
        current_cost_ref: unitCost,
        current_stock: 0,
        min_stock: 5,
        name: unitName,
        sale_price_ref: input.unitProduct?.salePriceRef ?? 0,
        sku: unitSku,
        store_id: storeId,
      })
      .select("id")
      .single();

    throwIfSupabaseError(unitError);

    if (!unitRow?.id) {
      throw new ApiError(500, "INTERNAL_ERROR", "No se pudo crear el producto unidad.");
    }

    unitProductId = unitRow.id;
  }

  const existing = await findActiveRecipe(supabase, packProductId, storeId);

  // Mismo producto unidad: se edita en sitio, como siempre (una sola sentencia;
  // el trigger de la cabecera deja el componente al día).
  if (existing && existing.unit_product_id === unitProductId) {
    const { error } = await supabase
      .from("product_pack_conversions")
      .update({
        unit_product_id: unitProductId,
        units_per_pack: unitsPerPack,
      })
      .eq("id", existing.id);

    throwIfSupabaseError(error);
    return;
  }

  // Otro producto unidad, o la receta vigente es surtida: receta nueva y la
  // anterior queda inactiva (ver `saveAssortedRecipe`).
  if (existing) {
    throwIfSupabaseError(await setRecipeActive(supabase, existing.id, false));
  }

  const { error: insertError } = await supabase.from("product_pack_conversions").insert({
    pack_product_id: packProductId,
    store_id: storeId,
    unit_product_id: unitProductId,
    units_per_pack: unitsPerPack,
    is_active: true,
  });

  if (insertError) {
    throw await restorePreviousRecipe(supabase, existing?.id, insertError);
  }
}

export async function attachPackConversionToProduct<T extends { id: string }>(
  product: T,
  storeId: string,
) {
  const packConversion = await getPackConversionForProduct(product.id, storeId);
  return {
    ...product,
    ...(packConversion ? { packConversion } : {}),
  };
}

export type { PackConversionListItem } from "./packConversionSummary";
