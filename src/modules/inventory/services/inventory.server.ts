import { ApiError } from "@/lib/api/apiError";
import { assertSupabaseStoreResource } from "@/lib/api/assertStoreResource";
import { parsePagination } from "@/lib/api/pagination";
import {
  mapCategory,
  mapProductSummary,
  mapStockCardEntry,
  mapStockMovement,
  type CategoryRow,
  type DbProductSummaryRow,
  type DbStockMovementRow,
  type StockCardRow,
} from "@/lib/supabase/mappers";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import type { StockMovementType } from "@/shared/mocks/erp-data";

import {
  parseInventoryListFilters,
  type InventoryListQueryFilters,
} from "../utils/inventoryListFilters";
import type { InventoryStockStatus } from "../utils/inventoryStockStatus";
import {
  matchesInventoryMovementFilters,
  parseInventoryMovementFilters,
} from "../utils/inventoryMovementFilters";
import {
  assertPackDistribution,
  type PackDistributionItem,
} from "@/modules/products/services/packConversionSchemas";
import { assertListFilterParams } from "@/modules/products/services/listFilterParams";
import { isRangeNotSatisfiable, listCountOptions } from "@/modules/products/services/listRange";
import { buildProductSearchOrFilter } from "@/modules/products/services/productSearch";
import { applyCreatedAtCaracasRange } from "@/shared/utils/caracasBusinessDay";

import {
  canSeeInventoryReconciliation,
  type InventoryOverviewItem,
  type ListInventoryOptions,
} from "./inventoryOverview";
import { assertReturnAdjustmentHasDocument } from "./returnAdjustmentDocument";
import { isMissingRpcSignatureError, rpcWithClientRequestId } from "./rpcWithClientRequestId";

const productSummarySelect =
  "id, category_id, sku, barcode, name, sale_price_ref, current_cost_ref, current_stock, min_stock, image_url, is_active";

/** Vista `inventory_overview` (parche 20261011a): producto + cifras del libro + `stock_status`. */
const inventoryOverviewSelect = `
  ${productSummarySelect},
  entries_30d,
  exits_30d,
  last_movement_at,
  last_movement_type,
  stock_status,
  category:categories(id, name, description, is_active, created_at, updated_at)
`;

type InventoryOverviewRow = DbProductSummaryRow & {
  category?: CategoryRow | null;
  entries_30d?: number | null;
  exits_30d?: number | null;
  last_movement_at?: string | null;
  last_movement_type?: StockMovementType | null;
  stock_status: InventoryStockStatus;
};

function mapInventoryOverviewItem(row: InventoryOverviewRow): InventoryOverviewItem {
  return {
    ...mapProductSummary(row),
    category: row.category ? mapCategory(row.category) : undefined,
    entries30d: row.entries_30d ?? 0,
    exits30d: row.exits_30d ?? 0,
    lastMovementAt: row.last_movement_at ?? null,
    lastMovementType: row.last_movement_type ?? null,
    stockStatus: row.stock_status,
  };
}

/** Filtros exactos del listado que viajan tal cual a PostgREST. */
const INVENTORY_LIST_EXACT_FILTERS = ["categoryId", "productId"] as const;

/** `offset` máximo que se envía a PostgREST; más allá no puede haber filas. */
const MAX_LIST_SKIP = 2_000_000_000;

/**
 * Estados de stock que pide la consulta. `lowStock` equivale a "bajo o agotado"
 * y se cruza con `stockStatus`. `undefined` = sin filtro; lista vacía = nada casa.
 */
function resolveStockStatuses(
  filters: InventoryListQueryFilters,
): InventoryStockStatus[] | undefined {
  if (!filters.lowStock) {
    return filters.stockStatus;
  }

  return filters.stockStatus
    ? filters.stockStatus.filter((status) => status !== "ok")
    : ["low", "out"];
}

const stockMovementSelect = `
  id,
  product_id,
  type,
  quantity_delta,
  stock_after,
  sale_id,
  purchase_id,
  conversion_id,
  reason,
  created_at,
  product:products(${productSummarySelect})
`;

const stockCardSelect =
  "id, product_id, sku, product_name, type, quantity_delta, stock_after, sale_id, purchase_id, conversion_id, reason, created_by, created_at";

export async function listInventory(
  searchParams: URLSearchParams,
  storeId: string,
  options: ListInventoryOptions = {},
) {
  assertListFilterParams(searchParams, INVENTORY_LIST_EXACT_FILTERS);

  const filters = parseInventoryListFilters(searchParams);
  const { limit, skip } = parsePagination(searchParams);
  const stockStatuses = resolveStockStatuses(filters);

  if (stockStatuses?.length === 0) {
    return { items: [], limit, skip, total: 0 };
  }

  const supabase = await createRouteSupabaseClient();

  /** La consulta con todos los filtros; `head` = solo el conteo, sin filas. */
  const buildFilteredQuery = (head: boolean) => {
    let query = supabase
      .from("inventory_overview")
      .select(inventoryOverviewSelect, listCountOptions(head))
      .eq("store_id", storeId)
      .eq("is_active", true);

    if (filters.productId) {
      query = query.eq("id", filters.productId);
    }

    if (filters.search) {
      query = query.or(buildProductSearchOrFilter(filters.search));
    }

    if (filters.categoryId) {
      query = query.eq("category_id", filters.categoryId);
    }

    if (stockStatuses) {
      query = query.in("stock_status", stockStatuses);
    }

    if (filters.minPriceRef !== undefined) {
      query = query.gte("sale_price_ref", filters.minPriceRef);
    }

    if (filters.maxPriceRef !== undefined) {
      query = query.lte("sale_price_ref", filters.maxPriceRef);
    }

    return query;
  };

  /** Página más allá del total: no es un error, es una página vacía con el total real. */
  const emptyPage = async () => {
    const total = await buildFilteredQuery(true);

    throwIfSupabaseError(total.error);

    return { items: [], limit, skip, total: total.count ?? 0 };
  };

  if (skip > MAX_LIST_SKIP) {
    return emptyPage();
  }

  const { count, data, error, status } = await buildFilteredQuery(false)
    .order("name", { ascending: true })
    .order("id", { ascending: true })
    .range(skip, skip + limit - 1);

  if (isRangeNotSatisfiable(error, status)) {
    return emptyPage();
  }

  throwIfSupabaseError(error);

  const items = (data ?? []).map((row) =>
    mapInventoryOverviewItem(row as unknown as InventoryOverviewRow),
  );

  if (!canSeeInventoryReconciliation(options.role)) {
    return { items, limit, skip, total: count ?? 0 };
  }

  const diffs = await loadReconciliationDiffs(
    supabase,
    storeId,
    items.map((item) => item.id),
  );

  return {
    items: items.map((item) => ({
      ...item,
      reconciliationDiff: diffs.get(item.id) ?? null,
    })),
    limit,
    skip,
    total: count ?? 0,
  };
}

/**
 * Descuadre `current_stock − Σ movimientos` de los productos de la página
 * (`stock_reconciliation` solo lista los que no cuadran). Solo se consulta para admin.
 */
async function loadReconciliationDiffs(
  supabase: Awaited<ReturnType<typeof createRouteSupabaseClient>>,
  storeId: string,
  productIds: string[],
) {
  const diffs = new Map<string, number>();

  if (productIds.length === 0) {
    return diffs;
  }

  const { data, error } = await supabase
    .from("stock_reconciliation")
    .select("product_id, diff")
    .eq("store_id", storeId)
    .in("product_id", productIds);

  throwIfSupabaseError(error);

  for (const row of (data ?? []) as { diff: number; product_id: string }[]) {
    diffs.set(row.product_id, row.diff);
  }

  return diffs;
}

export async function listStockMovements(searchParams: URLSearchParams, storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const { limit, skip } = parsePagination(searchParams);
  const filters = parseInventoryMovementFilters(searchParams);

  let query = supabase
    .from("stock_movements")
    .select(stockMovementSelect, { count: "exact" })
    .eq("store_id", storeId)
    .order("created_at", { ascending: false });

  if (filters.productId) {
    query = query.eq("product_id", filters.productId);
  }

  if (filters.type) {
    query = query.eq("type", filters.type);
  }

  query = applyCreatedAtCaracasRange(query, filters.from, filters.to);

  const { count, data, error } = await query.range(skip, skip + limit - 1);

  throwIfSupabaseError(error);

  return {
    items: (data ?? []).map((row) => mapStockMovement(row as DbStockMovementRow)),
    limit,
    skip,
    total: count ?? 0,
  };
}

export async function getStockCard(searchParams: URLSearchParams, storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const { limit, skip } = parsePagination(searchParams);
  const productId = searchParams.get("productId");

  let query = supabase
    .from("stock_card")
    .select(stockCardSelect, { count: "exact" })
    .eq("store_id", storeId)
    .order("created_at", { ascending: false });

  if (productId) {
    query = query.eq("product_id", productId);
  }

  const { count, data, error } = await query.range(skip, skip + limit - 1);

  throwIfSupabaseError(error);

  return {
    items: (data ?? []).map((row) => mapStockCardEntry(row as StockCardRow)),
    limit,
    skip,
    total: count ?? 0,
  };
}

export async function createStockAdjustment(
  input: {
    clientRequestId?: string;
    productId: string;
    /** Compra a la que se liga una `devolucion_proveedor` (tope recibido − ya devuelto). */
    purchaseId?: string;
    quantityDelta: number;
    reason?: string;
    /** Venta a la que se liga una `devolucion_cliente` (tope vendido − ya devuelto). */
    saleId?: string;
    type?: StockMovementType;
  },
  storeId: string,
) {
  assertReturnAdjustmentHasDocument(input);
  await assertSupabaseStoreResource("products", input.productId, storeId, "Producto no encontrado.");
  const supabase = await createRouteSupabaseClient();
  // Solo viajan en una devolucion ligada: el resto de ajustes llama como siempre.
  const documentLink = {
    ...(input.saleId ? { p_sale_id: input.saleId } : {}),
    ...(input.purchaseId ? { p_purchase_id: input.purchaseId } : {}),
  };
  const { data, error } = await rpcWithClientRequestId(
    supabase,
    "adjust_stock",
    {
      p_product_id: input.productId,
      p_quantity_delta: input.quantityDelta,
      p_reason: input.reason ?? null,
      p_type: input.type ?? null,
    },
    input.clientRequestId,
    documentLink,
  );

  // R4: la base no conoce el vinculo (faltan los parches 20261006). No se repite
  // sin el: una devolucion sin documento no tiene tope y reabre el duplicado (C15).
  if (Object.keys(documentLink).length > 0 && isMissingRpcSignatureError(error)) {
    throw new ApiError(
      409,
      "CONFLICT",
      "Esta base aun no admite devoluciones ligadas a una venta o compra. No se registro el movimiento.",
    );
  }

  throwIfSupabaseError(error);

  return mapStockMovement(data as DbStockMovementRow);
}

type RouteSupabaseClient = Awaited<ReturnType<typeof createRouteSupabaseClient>>;

type PackConversionRequest = {
  clientRequestId?: string;
  /** Reparto real de esta apertura; sin él cada componente recibe lo de la receta. */
  components?: PackDistributionItem[];
  packProductId: string;
  packQuantity: number;
  reason?: string;
};

type PackConversionComponentPayload = {
  allocatedValueRef: number | string;
  costWeight: number | string;
  isActive: boolean;
  movement: DbStockMovementRow;
  newCostRef: number | string;
  unitCostRef: number | string;
  unitProductId: string;
  units: number;
};

/**
 * Rechazo temprano (400) de un reparto que no cuadra con la receta activa. La RPC
 * lo vuelve a comprobar dentro de su transaccion y es quien decide: si aqui no se
 * puede leer la receta (o el empaque no tiene), la respuesta la da ella.
 */
async function assertDistributionMatchesRecipe(
  supabase: RouteSupabaseClient,
  input: PackConversionRequest & { components: PackDistributionItem[] },
  storeId: string,
) {
  const { data, error } = await supabase
    .from("product_pack_conversions")
    .select("total_units, components:product_pack_components(unit_product_id)")
    .eq("store_id", storeId)
    .eq("pack_product_id", input.packProductId)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !data) {
    return;
  }

  const recipe = data as unknown as {
    components?: { unit_product_id: string }[] | null;
    total_units: number;
  };

  assertPackDistribution(
    {
      componentIds: (recipe.components ?? []).map((component) => component.unit_product_id),
      totalUnits: recipe.total_units,
    },
    input.packQuantity,
    input.components,
  );
}

export async function convertPackToUnits(input: PackConversionRequest, storeId: string) {
  await assertSupabaseStoreResource(
    "products",
    input.packProductId,
    storeId,
    "Producto de empaque no encontrado.",
  );
  const supabase = await createRouteSupabaseClient();
  const distribution = input.components;

  if (distribution) {
    await assertDistributionMatchesRecipe(supabase, { ...input, components: distribution }, storeId);
  }

  // Solo viaja cuando hay reparto: sin él la llamada es la de siempre. Va tal cual
  // llega (orden y ceros incluidos): la huella de idempotencia de la RPC lo incluye.
  const distributionArg = distribution
    ? {
        p_components: distribution.map((item) => ({
          unit_product_id: item.unitProductId,
          units: item.units,
        })),
      }
    : {};
  const { data, error } = await rpcWithClientRequestId(
    supabase,
    "convert_pack_to_units",
    {
      p_pack_product_id: input.packProductId,
      p_pack_quantity: input.packQuantity,
      p_reason: input.reason ?? null,
    },
    input.clientRequestId,
    distributionArg,
  );

  // La base no conoce `p_components` (falta el parche 20261009d). No se repite sin
  // él: abriría el empaque con el reparto de la receta, que no es el que se pidió.
  if (distribution && isMissingRpcSignatureError(error)) {
    throw new ApiError(
      409,
      "CONFLICT",
      "Esta base aun no admite el reparto de un empaque surtido. No se registro la conversion.",
    );
  }

  throwIfSupabaseError(error);

  const payload = data as {
    /** Ausente si la base aun no tiene el parche 20261009d. */
    components?: PackConversionComponentPayload[];
    conversionId: string;
    packMovement: DbStockMovementRow;
    unitMovement: DbStockMovementRow;
    packQuantity: number;
    /** Ausente si la base aun no tiene el parche 20261009d. */
    totalUnits?: number;
    unitQuantity: number;
    unitsPerPack: number;
    unitCostRef: number;
  };

  return {
    components: (payload.components ?? []).map((component) => ({
      allocatedValueRef: Number(component.allocatedValueRef),
      costWeight: Number(component.costWeight),
      isActive: component.isActive,
      movement: mapStockMovement(component.movement),
      newCostRef: Number(component.newCostRef),
      unitCostRef: Number(component.unitCostRef),
      unitProductId: component.unitProductId,
      units: component.units,
    })),
    conversionId: payload.conversionId,
    packQuantity: payload.packQuantity,
    totalUnits: payload.totalUnits ?? payload.unitsPerPack,
    unitCostRef: payload.unitCostRef,
    unitQuantity: payload.unitQuantity,
    unitsPerPack: payload.unitsPerPack,
    packMovement: mapStockMovement(payload.packMovement),
    unitMovement: mapStockMovement(payload.unitMovement),
  };
}

export { listPackConversions } from "@/modules/products/services/packConversion.server";

