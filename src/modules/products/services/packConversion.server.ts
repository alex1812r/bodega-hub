import { type DbProductSummaryRow } from "@/lib/supabase/mappers";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import type { ProductPackConversionSummary } from "@/shared/mocks/erp-data";
import { generateProductSkuFromName, normalizeSku } from "@/shared/utils/skuGeneration";

import type { PackConversionInput } from "./packConversionSchemas";
import { normalizeBarcode } from "./productSearch";
import type { ProductInput } from "./products.mock-server";
import { ApiError } from "@/lib/api/apiError";
import { assertSupabaseStoreResource } from "@/lib/api/assertStoreResource";

const linkedProductSelect =
  "id, sku, name, sale_price_ref, current_cost_ref, current_stock";

type PackConversionRow = {
  id: string;
  pack_product_id: string;
  unit_product_id: string;
  units_per_pack: number;
  pack_product?: DbProductSummaryRow | DbProductSummaryRow[] | null;
  unit_product?: DbProductSummaryRow | DbProductSummaryRow[] | null;
};

function resolveEmbedded<T>(value: T | T[] | null | undefined): T | undefined {
  if (!value) {
    return undefined;
  }

  return Array.isArray(value) ? value[0] : value;
}

function mapLinkedProduct(row: DbProductSummaryRow) {
  return {
    currentCostRef: Number(row.current_cost_ref ?? 0),
    currentStock: row.current_stock ?? 0,
    id: row.id,
    name: row.name,
    salePriceRef: Number(row.sale_price_ref ?? 0),
    sku: normalizeSku(row.sku),
  };
}

export function mapPackConversionRow(
  row: PackConversionRow,
  productId: string,
): ProductPackConversionSummary | undefined {
  const pack = resolveEmbedded(row.pack_product);
  const unit = resolveEmbedded(row.unit_product);

  if (!pack || !unit) {
    return undefined;
  }

  const isPack = row.pack_product_id === productId;

  return {
    id: row.id,
    role: isPack ? "pack" : "unit",
    unitsPerPack: row.units_per_pack,
    linkedProduct: mapLinkedProduct(isPack ? unit : pack),
  };
}

export async function getPackConversionForProduct(
  productId: string,
  storeId: string,
): Promise<ProductPackConversionSummary | undefined> {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("product_pack_conversions")
    .select(
      `
      id,
      pack_product_id,
      unit_product_id,
      units_per_pack,
      pack_product:products!pack_product_id(${linkedProductSelect}),
      unit_product:products!unit_product_id(${linkedProductSelect})
    `,
    )
    .eq("store_id", storeId)
    .eq("is_active", true)
    .or(`pack_product_id.eq.${productId},unit_product_id.eq.${productId}`)
    .maybeSingle();

  throwIfSupabaseError(error);

  if (!data) {
    return undefined;
  }

  return mapPackConversionRow(data as PackConversionRow, productId);
}

export async function listPackConversions(storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("product_pack_conversions")
    .select(
      `
      id,
      pack_product_id,
      unit_product_id,
      units_per_pack,
      pack_product:products!pack_product_id(${linkedProductSelect}),
      unit_product:products!unit_product_id(${linkedProductSelect})
    `,
    )
    .eq("store_id", storeId)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  throwIfSupabaseError(error);

  return (data ?? [])
    .map((row) => {
      const mapped = mapPackConversionRow(row as PackConversionRow, (row as PackConversionRow).pack_product_id);
      if (!mapped) {
        return null;
      }

      const pack = resolveEmbedded((row as PackConversionRow).pack_product);

      return {
        ...mapped,
        packProduct: pack ? mapLinkedProduct(pack) : mapped.linkedProduct,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

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
    .select("id, pack_product_id, unit_product_id")
    .eq("store_id", storeId)
    .eq("is_active", true)
    .or(`pack_product_id.eq.${unitProductId},unit_product_id.eq.${unitProductId}`)
    .maybeSingle();

  throwIfSupabaseError(error);

  if (data && data.pack_product_id !== packProductId) {
    throw new ApiError(409, "CONFLICT", "El producto unidad ya esta vinculado a otro empaque.");
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

  const { data: existing, error: existingError } = await supabase
    .from("product_pack_conversions")
    .select("id")
    .eq("store_id", storeId)
    .eq("pack_product_id", packProductId)
    .eq("is_active", true)
    .maybeSingle();

  throwIfSupabaseError(existingError);

  if (existing?.id) {
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

  const { error: insertError } = await supabase.from("product_pack_conversions").insert({
    pack_product_id: packProductId,
    store_id: storeId,
    unit_product_id: unitProductId,
    units_per_pack: unitsPerPack,
    is_active: true,
  });

  throwIfSupabaseError(insertError);
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

/** Re-export for inventory list typing. */
export type PackConversionListItem = ProductPackConversionSummary & {
  packProduct: ProductPackConversionSummary["linkedProduct"];
};
