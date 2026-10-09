import { ApiError } from "@/lib/api/apiError";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { isRangeNotSatisfiable } from "@/modules/products/services/listRange";

import { listStockMovements } from "./inventory.server";
import {
  buildKardexSeries,
  getKardexWindow,
  KARDEX_LAST_MOVEMENTS,
  KARDEX_WINDOW_MAX_ROWS,
  KARDEX_WINDOW_PAGE_SIZE,
  type KardexWindowRow,
  type ProductKardex,
  readKardexProductId,
  toKardexMovement,
} from "./productKardex";

type RouteSupabaseClient = Awaited<ReturnType<typeof createRouteSupabaseClient>>;

type KardexProductRow = {
  current_stock: number;
  id: string;
  min_stock: number;
  name: string;
  sku: string;
};

type KardexWindowDbRow = {
  created_at: string;
  quantity_delta: number;
  seq: number | string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Movimientos del producto desde `startUtc`, del más reciente al más antiguo
 * por fecha. Lee solo `seq`, `quantity_delta` y `created_at`, en páginas de
 * `KARDEX_WINDOW_PAGE_SIZE` y hasta `KARDEX_WINDOW_MAX_ROWS` filas: un producto
 * con decenas de miles de movimientos en la ventana cuesta como mucho 5
 * consultas. `truncated` = se alcanzó el tope (con exactamente
 * `KARDEX_WINDOW_MAX_ROWS` filas también: no se lee una fila más para saberlo).
 *
 * Las páginas son por desplazamiento: un movimiento registrado entre dos
 * lecturas corre las filas y repite una en el borde; se descarta por `seq`.
 */
async function readWindowRows(
  supabase: RouteSupabaseClient,
  params: { productId: string; startUtc: string; storeId: string },
) {
  const rows: KardexWindowRow[] = [];
  const seen = new Set<string>();

  for (let offset = 0; offset < KARDEX_WINDOW_MAX_ROWS; offset += KARDEX_WINDOW_PAGE_SIZE) {
    const { data, error, status } = await supabase
      .from("stock_movements")
      .select("seq, quantity_delta, created_at")
      .eq("store_id", params.storeId)
      .eq("product_id", params.productId)
      .gte("created_at", params.startUtc)
      .order("created_at", { ascending: false })
      .order("seq", { ascending: false })
      .range(offset, offset + KARDEX_WINDOW_PAGE_SIZE - 1);

    // El total era múltiplo exacto de la página: la siguiente empieza más allá del final.
    if (isRangeNotSatisfiable(error, status)) {
      return { rows, truncated: false };
    }

    throwIfSupabaseError(error);

    const page = (data ?? []) as KardexWindowDbRow[];

    for (const row of page) {
      const key = String(row.seq);

      if (!seen.has(key)) {
        seen.add(key);
        rows.push({ createdAt: row.created_at, quantityDelta: Number(row.quantity_delta) });
      }
    }

    if (page.length < KARDEX_WINDOW_PAGE_SIZE) {
      return { rows, truncated: false };
    }
  }

  return { rows, truncated: true };
}

/**
 * Kardex de un producto de la tienda: saldo, serie diaria de los últimos 30
 * días de Caracas y últimos movimientos. Un producto de otra tienda responde
 * 404, igual que uno que no existe.
 */
export async function getProductKardex(
  searchParams: URLSearchParams,
  storeId: string,
): Promise<ProductKardex> {
  const productId = readKardexProductId(searchParams);

  if (!UUID_PATTERN.test(productId)) {
    throw new ApiError(400, "BAD_REQUEST", 'El filtro "productId" no es válido.');
  }

  const supabase = await createRouteSupabaseClient();
  const { data: product, error } = await supabase
    .from("products")
    .select("id, name, sku, current_stock, min_stock")
    .eq("id", productId)
    .eq("store_id", storeId)
    .maybeSingle<KardexProductRow>();

  throwIfSupabaseError(error);

  if (!product) {
    throw new ApiError(404, "NOT_FOUND", "Producto no encontrado.");
  }

  const window = getKardexWindow();
  const { rows, truncated } = await readWindowRows(supabase, {
    productId,
    startUtc: window.startUtc,
    storeId,
  });
  const lastMovements = await listStockMovements(
    new URLSearchParams({ limit: String(KARDEX_LAST_MOVEMENTS), productId }),
    storeId,
  );
  const currentStock = Number(product.current_stock);

  return {
    ...buildKardexSeries({ currentStock, dates: window.dates, rows, truncated }),
    lastMovements: lastMovements.items.map(toKardexMovement),
    product: {
      currentStock,
      id: product.id,
      minStock: Number(product.min_stock),
      name: product.name,
      sku: product.sku,
    },
    truncated,
  };
}
