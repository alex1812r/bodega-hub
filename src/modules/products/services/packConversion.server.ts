import { type DbProductSummaryRow } from "@/lib/supabase/mappers";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { isMissingRpcSignatureError } from "@/modules/inventory/services/rpcWithClientRequestId";
import type { ProductPackConversionSummary } from "@/shared/mocks/erp-data";
import { generateProductSkuFromName, normalizeSku } from "@/shared/utils/skuGeneration";

import type { PackConversionInput } from "./packConversionSchemas";
import {
  buildPackConversionListItem,
  buildPackConversionSummary,
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
 * Comprobación previa al ALTA de un producto con receta (el empaque aún no
 * existe): un producto unidad puede salir de varios empaques, pero no puede ser
 * él mismo el EMPAQUE de una receta activa (cadena de empaques). Al guardar, la
 * regla la impone `save_pack_recipe` con los productos bloqueados.
 */
async function assertUnitAvailable(unitProductId: string, storeId: string) {
  await assertSupabaseStoreResource(
    "products",
    unitProductId,
    storeId,
    "Producto unidad no encontrado.",
  );

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
) {
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

type PackNameRow = { name?: string | null };
type PackOfComponentConversionRow = { pack_product?: PackNameRow | PackNameRow[] | null };
type PackOfComponentRow = {
  conversion?: PackOfComponentConversionRow | PackOfComponentConversionRow[] | null;
};

/**
 * La misma regla de cadenas en el otro sentido: un producto que ya sale de un
 * empaque (componente de una receta ACTIVA) no puede estrenar receta propia.
 * Solo se llama cuando el producto aún NO tiene receta activa: quien ya era
 * empaque y componente (datos anteriores a la regla) sigue pudiendo editar su
 * receta. Aquí es solo la comprobación previa de `create_unit` (antes de crear
 * la unidad); quien la impone es `save_pack_recipe`, con el mismo mensaje.
 */
async function assertPackIsNotComponent(
  supabase: RouteSupabaseClient,
  packProductId: string,
  storeId: string,
) {
  const { data, error } = await supabase
    .from("product_pack_components")
    .select(
      "conversion:product_pack_conversions!inner(pack_product:products!pack_product_id(name))",
    )
    .eq("store_id", storeId)
    .eq("unit_product_id", packProductId)
    .eq("conversion.is_active", true);

  throwIfSupabaseError(error);

  const [source] = (data ?? []) as unknown as PackOfComponentRow[];

  if (!source) {
    return;
  }

  const packName = resolveEmbedded(resolveEmbedded(source.conversion)?.pack_product)?.name;

  throw new ApiError(
    409,
    "CONFLICT",
    `Este producto ya es unidad de ${packName?.trim() || "otro empaque"}; no puede ser a la vez un empaque.`,
  );
}

/** Nombre y SKU del producto unidad que crea el modo `create_unit`. */
function resolveNewUnitIdentity(input: PackConversionInput, packName: string | undefined) {
  const name = input.unitProduct?.name?.trim() || `${packName ?? "Producto"} (unidad)`;

  return {
    name,
    sku: normalizeSku(input.unitProduct?.sku ?? "") || generateProductSkuFromName(name),
  };
}

/**
 * Lo que se puede comprobar de una receta ANTES de que exista su empaque (alta
 * de producto): que la unidad / los componentes existan en la tienda y no sean
 * el empaque de una receta activa, y que el SKU de la unidad por crear esté
 * libre. La forma (suma, repetidos, mínimos) ya la validó
 * `packConversionInputSchema`. Así un alta con una receta inválida no deja el
 * producto creado sin receta. Al guardar, `save_pack_recipe` lo vuelve a
 * comprobar con los productos bloqueados (otra petición pudo cambiarlo entre medias).
 */
export async function assertPackConversionCanBeCreated(
  storeId: string,
  input: PackConversionInput,
  packProduct: { name?: string; sku?: string },
) {
  if (!input.enabled) {
    return;
  }

  const supabase = await createRouteSupabaseClient();

  if (input.mode === "assorted") {
    await assertComponentsAvailable(
      supabase,
      (input.components ?? []).map((component) => component.unitProductId),
      storeId,
    );
    return;
  }

  if (input.mode === "link_existing") {
    if (!input.unitProductId) {
      throw new ApiError(400, "BAD_REQUEST", "Selecciona el producto unidad.");
    }

    await assertUnitAvailable(input.unitProductId, storeId);
    return;
  }

  const unit = resolveNewUnitIdentity(input, packProduct.name);
  const { data, error } = await supabase
    .from("products")
    .select("id")
    .eq("store_id", storeId)
    .eq("sku", unit.sku)
    .maybeSingle();

  throwIfSupabaseError(error);

  if (data || unit.sku === normalizeSku(packProduct.sku ?? "")) {
    throw new ApiError(409, "CONFLICT", "Ya existe un producto con este SKU de unidad.");
  }
}

/**
 * Borra el producto unidad que `create_unit` acaba de insertar cuando su receta
 * no llegó a guardarse: no tiene movimientos ni receta, y dejarlo haría chocar
 * el reintento con su SKU. Si el borrado falla, queda un producto suelto sin stock.
 */
async function discardCreatedUnit(
  supabase: RouteSupabaseClient,
  unitProductId: string,
  storeId: string,
) {
  await supabase.from("products").delete().eq("id", unitProductId).eq("store_id", storeId);
}

/** ¿El empaque tiene receta activa? (a lo sumo una: `uq_product_pack_conversions_pack_active`). */
async function hasActiveRecipe(
  supabase: RouteSupabaseClient,
  packProductId: string,
  storeId: string,
) {
  const { data, error } = await supabase
    .from("product_pack_conversions")
    .select("id")
    .eq("store_id", storeId)
    .eq("pack_product_id", packProductId)
    .eq("is_active", true)
    .maybeSingle();

  throwIfSupabaseError(error);

  return Boolean(data);
}

type PackRecipeArgs = {
  components: { costWeight: number; unitProductId: string; unitsPerPack: number }[];
  label: string | null;
  totalUnits: number;
};

/**
 * Guarda (`recipe`) o desactiva (`null`) la receta del empaque con la RPC
 * `save_pack_recipe` (parche 20261011c): una sola transacción con el empaque y
 * sus componentes bloqueados. La base valida existencia, tienda y la regla de
 * cadenas en los dos sentidos, y decide si no escribe (misma receta), edita en
 * sitio (misma unidad, otras unidades) o desactiva la anterior y crea otra. Sus
 * rechazos (`PT400/404/409`) llegan con el mensaje de la base. La tienda la
 * resuelve la base con la sesión, no un argumento.
 *
 * Base sin el parche (`PGRST202`, no se ejecutó nada): 409. No hay camino
 * alternativo por tabla: no sería atómico.
 */
async function savePackRecipe(
  supabase: RouteSupabaseClient,
  packProductId: string,
  recipe: PackRecipeArgs | null,
) {
  const { error } = await supabase.rpc("save_pack_recipe", {
    p_components:
      recipe?.components.map((component) => ({
        cost_weight: component.costWeight,
        unit_product_id: component.unitProductId,
        units_per_pack: component.unitsPerPack,
      })) ?? null,
    p_enabled: recipe !== null,
    p_label: recipe?.label ?? null,
    p_pack_product_id: packProductId,
    p_total_units: recipe?.totalUnits ?? null,
  });

  if (isMissingRpcSignatureError(error)) {
    throw new ApiError(
      409,
      "CONFLICT",
      "Esta base aún no admite guardar la receta de un empaque de forma segura. No se guardó la receta.",
    );
  }

  throwIfSupabaseError(error);
}

export async function upsertPackConversionForPackProduct(
  packProductId: string,
  storeId: string,
  input: PackConversionInput,
  packProduct?: ProductInput & { name?: string; categoryId?: string; currentCostRef?: number },
) {
  const supabase = await createRouteSupabaseClient();

  if (!input.enabled) {
    await savePackRecipe(supabase, packProductId, null);
    return;
  }

  if (input.mode === "assorted") {
    await savePackRecipe(supabase, packProductId, {
      components: (input.components ?? []).map((component) => ({
        costWeight: component.costWeight,
        unitProductId: component.unitProductId,
        unitsPerPack: component.unitsPerPack,
      })),
      label: input.label?.trim() || null,
      totalUnits: input.totalUnits ?? 0,
    });
    return;
  }

  const unitsPerPack = input.unitsPerPack ?? 2;
  const singleRecipe = (unitProductId: string): PackRecipeArgs => ({
    components: [{ costWeight: 1, unitProductId, unitsPerPack }],
    label: null,
    totalUnits: unitsPerPack,
  });

  if (input.mode === "link_existing") {
    if (!input.unitProductId) {
      throw new ApiError(400, "BAD_REQUEST", "Selecciona el producto unidad.");
    }

    await savePackRecipe(supabase, packProductId, singleRecipe(input.unitProductId));
    return;
  }

  // `create_unit`. Antes de crear el producto unidad: el rechazo más previsible
  // (el empaque ya sale de otro empaque) no debe dejar nada escrito. La RPC lo
  // vuelve a comprobar; si rechaza la receta, la unidad recién creada se borra.
  if (!(await hasActiveRecipe(supabase, packProductId, storeId))) {
    await assertPackIsNotComponent(supabase, packProductId, storeId);
  }

  const { name: unitName, sku: unitSku } = resolveNewUnitIdentity(input, packProduct?.name);
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

  try {
    await savePackRecipe(supabase, packProductId, singleRecipe(unitRow.id));
  } catch (error) {
    await discardCreatedUnit(supabase, unitRow.id, storeId);
    throw error;
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
