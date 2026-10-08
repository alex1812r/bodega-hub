import { createHash } from "node:crypto";

import { ApiError } from "@/lib/api/apiError";
import { assertSupabaseStoreResource } from "@/lib/api/assertStoreResource";
import { parsePagination } from "@/lib/api/pagination";
import {
  mapProduct,
  type ProductPriceHistoryRow,
  type ProductRow,
} from "@/lib/supabase/mappers";
import { mapSupabaseError, throwIfSupabaseError } from "@/lib/supabase/errors";
import { getSupabaseUrl } from "@/lib/supabase/env";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { getPricingSettings } from "@/modules/settings/services/settings.server";

import {
  assertPackConversionCanBeCreated,
  attachPackConversionToProduct,
  upsertPackConversionForPackProduct,
} from "./packConversion.server";
import { assertListFilterParams } from "./listFilterParams";
import { isRangeNotSatisfiable, listCountOptions } from "./listRange";
import { parsePackLinkFilter, type PackConversionInput } from "./packConversionSchemas";
import {
  isPriceReviewFilterOn,
  PRICE_HISTORY_COLUMNS,
  PRICE_REVIEW_COLUMNS,
  toProductPriceHistoryEntry,
} from "./priceReview";
import { assertAllowedProductImageUrl } from "./productImagePaths";
import type {
  ProductInput,
  ProductPriceInput,
} from "./products.mock-server";
import {
  buildGeneratedSku,
  GENERATED_SKU_EXHAUSTED_MESSAGE,
  GENERATED_SKU_MAX_ATTEMPTS,
} from "./productSku";
import {
  applyProductMarginFilter,
  getProductMarginThresholds,
  parseProductMarginFilter,
} from "./productMargin";
import {
  buildProductCreateFingerprint,
  PRODUCT_CATEGORY_INACTIVE_MESSAGE,
  PRODUCT_CATEGORY_NOT_IN_STORE_MESSAGE,
  PRODUCT_CATEGORY_REQUIRED_MESSAGE,
  PRODUCT_CREATE_REQUEST_REUSED_MESSAGE,
  PRODUCT_EDIT_PRICE_REASON,
} from "./productSchemas";
import { applyProductSort } from "./productSort";
import {
  buildProductSearchOrFilter,
  isUnsearchableSearchTerm,
  normalizeBarcode,
  normalizeProductSearch,
} from "./productSearch";
import {
  buildProductSaleHistoryResult,
  mapProductSaleHistoryRow,
} from "./productSales";
import { normalizeSku } from "@/shared/utils/skuGeneration";

function assertProductImageUrlInput(productId: string, imageUrl: string | null | undefined) {
  if (imageUrl == null) {
    return;
  }

  try {
    assertAllowedProductImageUrl(getSupabaseUrl(), productId, imageUrl);
  } catch (error) {
    throw new ApiError(
      400,
      "BAD_REQUEST",
      error instanceof Error ? error.message : "imageUrl no es valido para este producto.",
    );
  }
}

/**
 * Categoría de un alta o de un cambio de categoría: existe, es de la tienda del
 * servidor y está activa. La FK `products.category_id` no mira la tienda, así
 * que sin esto se podía guardar la categoría de otra. Una sola lectura.
 */
async function assertProductCategory(
  supabase: Awaited<ReturnType<typeof createRouteSupabaseClient>>,
  categoryId: string,
  storeId: string,
) {
  if (!categoryId.trim()) {
    throw new ApiError(400, "BAD_REQUEST", PRODUCT_CATEGORY_REQUIRED_MESSAGE);
  }

  const { data, error } = await supabase
    .from("categories")
    .select("id, is_active")
    .eq("id", categoryId)
    .eq("store_id", storeId)
    .maybeSingle<{ id: string; is_active: boolean }>();

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(400, "BAD_REQUEST", PRODUCT_CATEGORY_NOT_IN_STORE_MESSAGE);
  }

  if (!data.is_active) {
    throw new ApiError(400, "BAD_REQUEST", PRODUCT_CATEGORY_INACTIVE_MESSAGE);
  }
}

/** Precio REF a dos decimales, como lo guarda `products.sale_price_ref`. */
function roundPriceRef(value: number) {
  return Math.round(value * 100) / 100;
}

export type ProductInputWithPackConversion = ProductInput & {
  packConversion?: PackConversionInput;
};

const productRowSelect = `
  id,
  category_id,
  sku,
  barcode,
  name,
  description,
  sale_price_ref,
  current_cost_ref,
  current_stock,
  min_stock,
  image_url,
  is_active,
  created_at,
  updated_at,
  category:categories(id, name, description, tax_rate, default_markup_pct, is_active, created_at, updated_at)
`;

/**
 * Lectura de un producto: la fila más `price_review`, la relación calculada del
 * parche 20261009c que trae su fila de la cola "Por revisar" (o nada). Las
 * escrituras devuelven solo `productRowSelect`: el `returning` de PostgREST
 * resuelve la relación con los datos de ANTES del cambio.
 */
const productSelect = `${productRowSelect},
  price_review:price_review(${PRICE_REVIEW_COLUMNS})
`;

/**
 * `review=1`: el mismo select con la relación `price_review` como inner join,
 * que deja solo los productos de la cola "Por revisar" (parche 20261009c). El
 * filtro lo resuelve Postgres: se combina con los demás filtros, el orden, el
 * conteo y la paginación sin pasar listas de ids.
 */
const productReviewOnlySelect = productSelect.replace(
  "price_review:price_review(",
  "price_review:price_review!inner(",
);

/**
 * `packLink`: la relación calculada `pack_role` (vista `product_pack_roles`,
 * parche 20261009d) como inner join. El rol de empaque lo resuelve Postgres por
 * producto: el filtro no viaja como lista de ids y se combina con los demás
 * filtros, el orden, el conteo y la paginación.
 */
const packRoleFilterSelect = "pack_role:pack_role!inner(is_pack, is_component)";

/** Clave de idempotencia de un alta y la huella del contenido que se envió con ella. */
type ProductCreateRequest = { hash: string; id: string };

function toProductInsert(
  input: ProductInput,
  sku: string,
  storeId: string,
  request: ProductCreateRequest | null,
) {
  return {
    // Sin clave (importación, clientes anteriores) las columnas no viajan.
    ...(request ? { client_request_hash: request.hash, client_request_id: request.id } : {}),
    barcode: normalizeBarcode(input.barcode),
    category_id: input.categoryId ?? null,
    current_cost_ref: input.currentCostRef ?? 0,
    // Siempre 0: el stock inicial entra por `adjust_stock` (movimiento
    // `inventario_inicial`), nunca como valor crudo de la fila (C1).
    current_stock: 0,
    description: input.description ?? null,
    image_url: input.imageUrl ?? null,
    min_stock: input.minStock ?? 5,
    name: input.name ?? "Producto",
    sale_price_ref: input.salePriceRef ?? 0,
    sku,
    store_id: storeId,
  };
}

function toProductUpdate(input: ProductInput) {
  // SKU vacio = se conserva el actual: ni se borra ni se regenera.
  const sku = normalizeSku(input.sku ?? "");

  return {
    ...(input.barcode !== undefined ? { barcode: normalizeBarcode(input.barcode) } : {}),
    ...(input.categoryId !== undefined ? { category_id: input.categoryId ?? null } : {}),
    ...(input.currentCostRef !== undefined ? { current_cost_ref: input.currentCostRef } : {}),
    // `current_stock` nunca se escribe desde aqui: solo los RPC con movimiento
    // (create_sale, adjust_stock, receive_purchase...) pueden moverlo.
    // `null` la borra; ausente, se conserva la guardada.
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.imageUrl !== undefined ? { image_url: input.imageUrl } : {}),
    ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
    ...(input.minStock !== undefined ? { min_stock: input.minStock } : {}),
    ...(input.name !== undefined ? { name: input.name } : {}),
    // `sale_price_ref` tampoco: el precio solo cambia por `update_product_price`,
    // que deja la fila de historial y la instantánea de costo y banda.
    ...(sku ? { sku } : {}),
  };
}

function applyProductFilters<TQuery extends {
  eq: (column: string, value: boolean | string) => TQuery;
  or: (filters: string) => TQuery;
}>(query: TQuery, searchParams: URLSearchParams): TQuery {
  const barcode = normalizeBarcode(searchParams.get("barcode"));
  const categoryId = searchParams.get("categoryId");
  const isActive = searchParams.get("isActive");
  const search = normalizeProductSearch(searchParams.get("search"));
  const sku = normalizeSku(searchParams.get("sku") ?? "");

  let filteredQuery = query;

  if (categoryId) {
    filteredQuery = filteredQuery.eq("category_id", categoryId);
  }

  if (isActive !== null) {
    filteredQuery = filteredQuery.eq("is_active", isActive.toLowerCase() === "true");
  }

  if (barcode) {
    filteredQuery = filteredQuery.eq("barcode", barcode);
  }

  if (sku) {
    filteredQuery = filteredQuery.eq("sku", sku);
  }

  // Los filtros exactos mandan sobre la busqueda parcial.
  if (barcode || sku) {
    return filteredQuery;
  }

  if (search) {
    filteredQuery = filteredQuery.or(buildProductSearchOrFilter(search));
  }

  return filteredQuery;
}

/** Filtros exactos del listado: se validan antes de consultar. */
export const PRODUCT_LIST_EXACT_FILTERS = ["barcode", "categoryId", "sku"] as const;

/**
 * La búsqueda parcial trae un término que casaría con todo (solo comodines o
 * caracteres de control) y ningún filtro exacto la sustituye.
 */
export function isProductSearchUnsearchable(searchParams: URLSearchParams) {
  return (
    !normalizeBarcode(searchParams.get("barcode")) &&
    !normalizeSku(searchParams.get("sku") ?? "") &&
    isUnsearchableSearchTerm(searchParams.get("search"))
  );
}

export async function listProducts(searchParams: URLSearchParams, storeId: string) {
  assertListFilterParams(searchParams, PRODUCT_LIST_EXACT_FILTERS);

  const { limit, skip } = parsePagination(searchParams);

  if (isProductSearchUnsearchable(searchParams)) {
    return { items: [], limit, skip, total: 0 };
  }

  const supabase = await createRouteSupabaseClient();
  const packLink = parsePackLinkFilter(searchParams);
  const baseSelect = isPriceReviewFilterOn(searchParams) ? productReviewOnlySelect : productSelect;

  // Los cortes del semáforo son los de la tienda: una sola lectura por petición
  // y solo cuando el filtro los usa ("none" y sin filtro no los necesitan).
  const marginFilter = parseProductMarginFilter(searchParams);
  const marginThresholds = getProductMarginThresholds(
    marginFilter !== null && marginFilter !== "none" ? await getPricingSettings(storeId) : null,
  );

  /** La consulta con todos los filtros; `head` = solo el conteo, sin filas. */
  const buildFilteredQuery = (head: boolean) => {
    let query = supabase
      .from("products")
      .select(
        packLink ? `${baseSelect}, ${packRoleFilterSelect}` : baseSelect,
        listCountOptions(head),
      )
      .eq("store_id", storeId);

    query = applyProductFilters(query, searchParams);
    query = applyProductMarginFilter(query, marginFilter, marginThresholds);

    if (packLink) {
      query = query.is("pack_role.is_pack", false);
    }

    if (packLink === "none") {
      query = query.is("pack_role.is_component", false);
    }

    return query;
  };

  const { count, data, error, status } = await applyProductSort(
    buildFilteredQuery(false),
    searchParams,
  ).range(skip, skip + limit - 1);

  // Página más allá del total: no es un error, es una página vacía con el total real.
  if (isRangeNotSatisfiable(error, status)) {
    const total = await buildFilteredQuery(true);

    throwIfSupabaseError(total.error);

    return { items: [], limit, skip, total: total.count ?? 0 };
  }

  throwIfSupabaseError(error);

  return {
    items: (data ?? []).map((row) => mapProduct(row as unknown as ProductRow)),
    limit,
    skip,
    total: count ?? 0,
  };
}

export async function getProductById(id: string, storeId: string) {
  await assertSupabaseStoreResource("products", id, storeId, "Producto no encontrado.");
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("products")
    .select(productSelect)
    .eq("id", id)
    .maybeSingle<ProductRow>();

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "Producto no encontrado.");
  }

  return attachPackConversionToProduct(mapProduct(data), storeId);
}

const INITIAL_STOCK_REASON = "Inventario inicial al crear el producto";

const PRODUCT_CREATE_REQUEST_INDEX = "products_store_client_request_unique";

/** Espacio de nombres (UUID fijo) de las claves derivadas de la clave de un alta. */
const INITIAL_STOCK_REQUEST_NAMESPACE = "8f1d6c0e-52a4-4a7b-9c3e-6b1f0d2a7e45";

/**
 * Clave de idempotencia del `inventario_inicial` de un alta: UUID v5 (SHA-1 del
 * espacio de nombres + la clave del producto). Determinista, así el reintento
 * del mismo alta llega a `adjust_stock` con la misma clave y la RPC devuelve el
 * movimiento ya hecho; distinta de la del producto, así no choca con la clave
 * que un ajuste manual pudiera reutilizar.
 */
export function deriveInitialStockRequestId(clientRequestId: string) {
  const bytes = createHash("sha1")
    .update(Buffer.from(INITIAL_STOCK_REQUEST_NAMESPACE.replace(/-/g, ""), "hex"))
    .update(clientRequestId.toLowerCase())
    .digest()
    .subarray(0, 16);

  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString("hex");

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function initialStockArgs(productId: string, quantity: number, request: ProductCreateRequest | null) {
  return {
    ...(request ? { p_client_request_id: deriveInitialStockRequestId(request.id) } : {}),
    p_product_id: productId,
    p_quantity_delta: quantity,
    p_reason: INITIAL_STOCK_REASON,
    p_type: "inventario_inicial",
  };
}

/** Violación del índice de la clave de idempotencia del alta (y no del SKU ni del código de barras). */
function isCreateRequestViolation(error: { code?: string; details?: string; message?: string } | null) {
  return (
    error?.code === "23505" &&
    `${error.message ?? ""} ${error.details ?? ""}`.includes(PRODUCT_CREATE_REQUEST_INDEX)
  );
}

/**
 * Alta ya hecha con esta clave (el cliente reintenta porque perdió la
 * respuesta): devuelve el producto que se creó, o `null` si la clave es nueva.
 * La misma clave con otro contenido es un 409, como en compras y ajustes.
 *
 * No repite el alta ni la receta. El stock inicial se vuelve a pedir con su
 * clave derivada: si ya se registró, `adjust_stock` devuelve aquel movimiento;
 * si el primer intento murió entre el producto y el stock, lo completa. Nunca
 * hay dos `inventario_inicial`. Un fallo aquí no borra el producto.
 */
async function replayCreateProduct(
  supabase: Awaited<ReturnType<typeof createRouteSupabaseClient>>,
  request: ProductCreateRequest,
  initialStock: number,
  storeId: string,
) {
  const { data, error } = await supabase
    .from("products")
    .select("id, client_request_hash")
    .eq("store_id", storeId)
    .eq("client_request_id", request.id)
    .maybeSingle<{ client_request_hash: string | null; id: string }>();

  throwIfSupabaseError(error);

  if (!data) {
    return null;
  }

  if (data.client_request_hash !== request.hash) {
    throw new ApiError(409, "CONFLICT", PRODUCT_CREATE_REQUEST_REUSED_MESSAGE);
  }

  if (initialStock > 0) {
    const { error: stockError } = await supabase.rpc(
      "adjust_stock",
      initialStockArgs(data.id, initialStock, request),
    );

    throwIfSupabaseError(stockError);
  }

  return getProductById(data.id, storeId);
}

/**
 * Registra el stock inicial de un producto recien creado como movimiento
 * `inventario_inicial` (RPC `adjust_stock`, con la sesion del usuario). Si el
 * ajuste falla, borra el producto para no dejar un alta a medias.
 */
async function registerInitialStock(
  supabase: Awaited<ReturnType<typeof createRouteSupabaseClient>>,
  productId: string,
  quantity: number,
  storeId: string,
  request: ProductCreateRequest | null,
) {
  const { error } = await supabase.rpc("adjust_stock", initialStockArgs(productId, quantity, request));

  if (!error) {
    return;
  }

  const adjustError = mapSupabaseError(error);
  const { data: deleted, error: deleteError } = await supabase
    .from("products")
    .delete()
    .eq("id", productId)
    .eq("store_id", storeId)
    .select("id");

  if (deleteError || !deleted?.length) {
    throw new ApiError(
      adjustError.status,
      adjustError.code,
      `${adjustError.message} Ademas no se pudo deshacer el alta: el producto quedo creado con stock 0 (id ${productId}). Registra su stock con un ajuste de inventario.`,
    );
  }

  throw adjustError;
}

/** Violacion de `products_store_sku_unique` (y no de la unicidad del codigo de barras). */
function isSkuUniqueViolation(error: { code?: string; details?: string; message?: string } | null) {
  return error?.code === "23505" && /sku/i.test(`${error.message ?? ""} ${error.details ?? ""}`);
}

/**
 * Inserta la fila del producto. Con SKU escrito hay un solo intento. Sin SKU lo
 * genera desde el nombre y, si choca con otro de la tienda, reintenta con sufijo:
 * la unicidad la decide el indice, no una consulta previa (dos altas a la vez).
 *
 * Devuelve `"replayed"` si la clave de idempotencia ya esta en otro producto de
 * la tienda (dos envios del mismo alta a la vez): lo decide su indice unico.
 */
async function insertProductRow(
  supabase: Awaited<ReturnType<typeof createRouteSupabaseClient>>,
  input: ProductInput,
  storeId: string,
  request: ProductCreateRequest | null,
) {
  const requestedSku = normalizeSku(input.sku ?? "");
  const attempts = requestedSku ? 1 : GENERATED_SKU_MAX_ATTEMPTS;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const sku = requestedSku || buildGeneratedSku(input.name ?? "", attempt);
    const { data, error } = await supabase
      .from("products")
      .insert(toProductInsert(input, sku, storeId, request))
      .select(productRowSelect)
      .single<ProductRow>();

    if (request && isCreateRequestViolation(error)) {
      return "replayed" as const;
    }

    if (!requestedSku && isSkuUniqueViolation(error)) {
      continue;
    }

    throwIfSupabaseError(error);

    return data;
  }

  throw new ApiError(409, "CONFLICT", GENERATED_SKU_EXHAUSTED_MESSAGE);
}

/**
 * La receta no se pudo guardar tras crear el producto (ya validada antes del
 * alta: es un fallo de la base o una carrera). Sin stock inicial el producto no
 * tiene movimientos y se borra, para que el reintento no choque con su SKU ni
 * lo duplique. Con stock inicial ya existe su `inventario_inicial` y no se
 * puede borrar: el error dice que quedó creado y cómo completarlo.
 */
async function undoCreateAfterRecipeFailure(
  supabase: Awaited<ReturnType<typeof createRouteSupabaseClient>>,
  productId: string,
  storeId: string,
  hasInitialStock: boolean,
  failure: unknown,
) {
  const recipeError = mapSupabaseError(failure);

  if (!hasInitialStock) {
    const { data: deleted, error: deleteError } = await supabase
      .from("products")
      .delete()
      .eq("id", productId)
      .eq("store_id", storeId)
      .select("id");

    if (!deleteError && deleted?.length) {
      return recipeError;
    }
  }

  return new ApiError(
    recipeError.status,
    recipeError.code,
    `El producto se creó pero el empaque no se pudo guardar: ${recipeError.message.replace(/\.$/, "")}. Edítalo para completar el empaque.`,
  );
}

/**
 * Alta de producto. Con receta de empaque el orden es:
 * 1. validar la receta (sin escribir nada: una receta inválida no crea el producto);
 * 2. insertar el producto;
 * 3. registrar el stock inicial (`inventario_inicial`; si falla, borra el producto);
 * 4. guardar la receta (si falla, `undoCreateAfterRecipeFailure`).
 * El stock va antes que la receta para que un fallo del ajuste nunca deje atrás
 * la unidad que crea `create_unit`.
 *
 * Con `clientRequestId` el alta es idempotente (C6): el reintento de un envío
 * cuya respuesta se perdió devuelve el producto ya creado (`replayCreateProduct`)
 * en vez de crear otro con su `inventario_inicial`.
 */
export async function createProduct(input: ProductInputWithPackConversion, storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const { clientRequestId, packConversion, ...productInput } = input;
  const initialStock = productInput.currentStock ?? 0;
  const request: ProductCreateRequest | null = clientRequestId
    ? {
        hash: createHash("sha256")
          .update(buildProductCreateFingerprint({ ...productInput, packConversion }))
          .digest("hex"),
        id: clientRequestId,
      }
    : null;

  // Antes de validar: tras el primer intento, el SKU o la unidad del empaque ya
  // existen y la validación del reintento fallaría contra su propio alta.
  const replayed = request
    ? await replayCreateProduct(supabase, request, initialStock, storeId)
    : null;

  if (replayed) {
    return replayed;
  }

  if (productInput.categoryId !== undefined) {
    await assertProductCategory(supabase, productInput.categoryId, storeId);
  }

  if (packConversion) {
    await assertPackConversionCanBeCreated(storeId, packConversion, {
      name: productInput.name,
      sku: productInput.sku,
    });
  }

  const data = await insertProductRow(supabase, productInput, storeId, request);

  if (data === "replayed" && request) {
    // El otro envío del mismo alta ganó la carrera del insert: su producto es el resultado.
    const winner = await replayCreateProduct(supabase, request, initialStock, storeId);

    if (winner) {
      return winner;
    }
  }

  if (!data || data === "replayed") {
    throw new ApiError(500, "INTERNAL_ERROR", "No se pudo crear el producto.");
  }

  if (initialStock > 0) {
    await registerInitialStock(supabase, data.id, initialStock, storeId, request);
  }

  if (packConversion) {
    try {
      await upsertPackConversionForPackProduct(data.id, storeId, packConversion, {
        categoryId: productInput.categoryId,
        currentCostRef: productInput.currentCostRef,
        name: productInput.name,
      });
    } catch (error) {
      throw await undoCreateAfterRecipeFailure(supabase, data.id, storeId, initialStock > 0, error);
    }
  }

  return getProductById(data.id, storeId);
}

/**
 * Edición de producto. El precio no se escribe con el resto de columnas: si
 * `salePriceRef` llega distinto del guardado (a dos decimales) se cambia con la
 * RPC `update_product_price`, la misma vía que `POST …/price`, con el motivo
 * "Edición del producto"; si es igual, se ignora.
 *
 * Orden: 1. validar (categoría, imagen); 2. update de las demás columnas;
 * 3. receta de empaque; 4. precio. El precio va al final para que la instantánea
 * de la RPC tome el costo ya guardado por esta misma edición (con el precio
 * primero quedaría el costo anterior y el producto entraría en "Por revisar"
 * sin motivo) y para que el historial nunca tenga un cambio de una edición que
 * después falló. Si la RPC falla, lo anterior queda guardado y el error lo dice.
 */
export async function updateProduct(
  id: string,
  input: ProductInputWithPackConversion,
  storeId: string,
) {
  await assertSupabaseStoreResource("products", id, storeId, "Producto no encontrado.");
  if (input.imageUrl !== undefined) {
    assertProductImageUrlInput(id, input.imageUrl);
  }
  const { packConversion, ...productInput } = input;
  const supabase = await createRouteSupabaseClient();
  let nextSalePriceRef: number | undefined;

  if (productInput.categoryId !== undefined || productInput.salePriceRef !== undefined) {
    const { data: current, error: currentError } = await supabase
      .from("products")
      .select("category_id, sale_price_ref")
      .eq("id", id)
      .maybeSingle<Pick<ProductRow, "category_id" | "sale_price_ref">>();

    throwIfSupabaseError(currentError);

    if (!current) {
      throw new ApiError(404, "NOT_FOUND", "Producto no encontrado.");
    }

    // La categoría que el producto ya tiene se puede reenviar tal cual (aunque
    // hoy esté inactiva); una distinta se valida, y vacía no se admite.
    if (productInput.categoryId !== undefined && productInput.categoryId !== current.category_id) {
      await assertProductCategory(supabase, productInput.categoryId, storeId);
    }

    if (
      productInput.salePriceRef !== undefined &&
      roundPriceRef(productInput.salePriceRef) !== roundPriceRef(Number(current.sale_price_ref))
    ) {
      nextSalePriceRef = productInput.salePriceRef;
    }
  }

  const productUpdate = toProductUpdate(productInput);
  // Sin columnas que cambiar (p. ej. solo `packConversion`) no hay update: uno
  // vacío no devuelve fila y la edición respondía 404. Basta leer el producto.
  const { data, error } = await (Object.keys(productUpdate).length > 0
    ? supabase.from("products").update(productUpdate).eq("id", id).select(productRowSelect)
    : supabase.from("products").select(productRowSelect).eq("id", id)
  ).maybeSingle<ProductRow>();

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "Producto no encontrado.");
  }

  if (packConversion) {
    await upsertPackConversionForPackProduct(id, storeId, packConversion, {
      categoryId: productInput.categoryId ?? data.category_id ?? undefined,
      currentCostRef:
        productInput.currentCostRef ??
        (data.current_cost_ref != null ? Number(data.current_cost_ref) : undefined),
      name: productInput.name ?? data.name,
    });
  }

  if (nextSalePriceRef !== undefined) {
    const { data: priced, error: priceError } = await supabase.rpc("update_product_price", {
      p_new_sale_price_ref: nextSalePriceRef,
      p_product_id: id,
      p_reason: PRODUCT_EDIT_PRICE_REASON,
    });

    if (priceError || !priced) {
      const failure = priceError
        ? mapSupabaseError(priceError)
        : new ApiError(404, "NOT_FOUND", "Producto no encontrado.");
      const savedOtherChanges = Object.keys(productUpdate).length > 0 || Boolean(packConversion);

      throw savedOtherChanges
        ? new ApiError(
            failure.status,
            failure.code,
            `${failure.message} Los demás cambios del producto se guardaron; el precio no cambió.`,
          )
        : failure;
    }
  }

  return getProductById(id, storeId);
}

export async function addProductBarcode(id: string, barcode: string, storeId: string) {
  await assertSupabaseStoreResource("products", id, storeId, "Producto no encontrado.");
  const normalized = normalizeBarcode(barcode);
  if (!normalized) {
    throw new ApiError(400, "BAD_REQUEST", "El codigo de barras es obligatorio.");
  }

  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase.rpc("add_product_barcode", {
    p_barcode: normalized,
    p_product_id: id,
  });

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "Producto no encontrado.");
  }

  return getProductById(id, storeId);
}

export async function deleteProduct(id: string, storeId: string) {
  await assertSupabaseStoreResource("products", id, storeId, "Producto no encontrado.");
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("products")
    .update({ is_active: false })
    .eq("id", id)
    .eq("is_active", true)
    .select(productRowSelect)
    .maybeSingle<ProductRow>();

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "Producto no encontrado.");
  }

  return {
    ...mapProduct(data),
    deleted: true,
  };
}

export async function updateProductPrice(id: string, input: ProductPriceInput, storeId: string) {
  await assertSupabaseStoreResource("products", id, storeId, "Producto no encontrado.");
  const supabase = await createRouteSupabaseClient();

  // Con el costo que vio el usuario, la comprobación y el cambio van en la misma
  // transacción (`update_product_price_checked`: PT409 si el costo ya es otro).
  // Sin él, la RPC de siempre.
  const { data: productRow, error: productError } =
    input.expectedCostRef === undefined
      ? await supabase.rpc("update_product_price", {
          p_new_sale_price_ref: input.salePriceRef,
          p_product_id: id,
          p_reason: input.reason ?? null,
        })
      : await supabase.rpc("update_product_price_checked", {
          p_expected_cost_ref: input.expectedCostRef,
          p_new_sale_price_ref: input.salePriceRef,
          p_product_id: id,
          p_reason: input.reason ?? null,
        });

  throwIfSupabaseError(productError);

  if (!productRow) {
    throw new ApiError(404, "NOT_FOUND", "Producto no encontrado.");
  }

  const { data: historyRow, error: historyError } = await supabase
    .from("product_price_history")
    .select(PRICE_HISTORY_COLUMNS)
    .eq("product_id", id)
    // La fila que acaba de insertar la RPC es la de mayor `snapshot_seq`.
    .order("snapshot_seq", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle<ProductPriceHistoryRow>();

  throwIfSupabaseError(historyError);

  if (!historyRow) {
    throw new ApiError(500, "INTERNAL_ERROR", "No se pudo registrar el historial de precio.");
  }

  const product = await getProductById(id, storeId);

  return {
    history: toProductPriceHistoryEntry(historyRow),
    product,
  };
}

export async function getProductPriceHistory(
  id: string,
  searchParams: URLSearchParams,
  storeId: string,
) {
  await assertSupabaseStoreResource("products", id, storeId, "Producto no encontrado.");
  const supabase = await createRouteSupabaseClient();
  const { limit, skip } = parsePagination(searchParams);

  const { count: productCount, error: productError } = await supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("id", id);

  throwIfSupabaseError(productError);

  if (!productCount) {
    throw new ApiError(404, "NOT_FOUND", "Producto no encontrado.");
  }

  const { count, data, error } = await supabase
    .from("product_price_history")
    .select(PRICE_HISTORY_COLUMNS, { count: "exact" })
    .eq("product_id", id)
    .order("created_at", { ascending: false })
    // Dos filas de la misma transacción comparten fecha: manda el orden en que se guardaron.
    .order("snapshot_seq", { ascending: false, nullsFirst: false })
    .range(skip, skip + limit - 1);

  throwIfSupabaseError(error);

  return {
    items: (data ?? []).map((row) => toProductPriceHistoryEntry(row as ProductPriceHistoryRow)),
    limit,
    skip,
    total: count ?? 0,
  };
}

type ProductSaleEmbed = {
  created_at: string;
  invoice_number: string;
  status: string;
  store_id: string;
};

type ProductSaleItemRow = {
  id: string;
  product_id: string;
  quantity: number;
  sale_id: string;
  sales: ProductSaleEmbed | ProductSaleEmbed[] | null;
  subtotal_ref: number;
  subtotal_ves: number;
  unit_price_ref: number;
};

const productSaleItemsSelect = `
  id,
  quantity,
  unit_price_ref,
  subtotal_ref,
  subtotal_ves,
  sale_id,
  product_id,
  sales!inner (
    invoice_number,
    created_at,
    status,
    store_id
  )
`;

function unwrapProductSale(sales: ProductSaleItemRow["sales"]) {
  if (!sales) {
    return null;
  }

  return Array.isArray(sales) ? (sales[0] ?? null) : sales;
}

export async function getProductSales(
  id: string,
  searchParams: URLSearchParams,
  storeId: string,
) {
  await assertSupabaseStoreResource("products", id, storeId, "Producto no encontrado.");
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("sale_items")
    .select(productSaleItemsSelect)
    .eq("product_id", id)
    .eq("sales.store_id", storeId);

  throwIfSupabaseError(error);

  const rows = ((data ?? []) as ProductSaleItemRow[]).flatMap((row) => {
    const sale = unwrapProductSale(row.sales);

    if (!sale) {
      return [];
    }

    return [
      mapProductSaleHistoryRow(
        {
          id: row.id,
          quantity: row.quantity,
          saleId: row.sale_id,
          subtotalRef: Number(row.subtotal_ref),
          subtotalVes: Number(row.subtotal_ves),
          unitPriceRef: Number(row.unit_price_ref),
        },
        {
          createdAt: sale.created_at,
          id: row.sale_id,
          invoiceNumber: sale.invoice_number,
          status: sale.status,
          storeId: sale.store_id,
        },
      ),
    ];
  });

  return buildProductSaleHistoryResult(rows, searchParams);
}
