import { ApiError } from "@/lib/api/apiError";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { isRangeNotSatisfiable } from "@/modules/products/services/listRange";

/** Tope de filas por respuesta de PostgREST: se lee en páginas de este tamaño. */
export const REPORT_FETCH_PAGE_SIZE = 1000;
/** Tope de filas de una lectura completa: más allá se rechaza, no se corta en silencio. */
export const REPORT_FETCH_MAX_ROWS = 200_000;

type RowsPage<Row> = {
  count?: number | null;
  data: Row[] | null;
  error: { code?: string; message?: string } | null;
  status?: number;
};

/**
 * Lee TODAS las filas de una consulta, página a página, por encima del tope de
 * 1.000 filas de PostgREST.
 *
 * `fetchPage` debe aplicar un orden estable por una columna única y
 * `.range(from, to)`; si además pide `count: "exact"`, la lectura termina sin
 * una consulta de más. Se avanza por las filas realmente recibidas (no por el
 * tamaño pedido), así que un tope de servidor menor que la página tampoco corta
 * la lectura.
 *
 * Las páginas son por desplazamiento: una fila insertada entre dos lecturas
 * puede repetir otra en el borde; con `getKey` se descarta la repetida.
 */
export async function fetchAllRows<Row>(
  fetchPage: (from: number, to: number) => PromiseLike<RowsPage<Row>>,
  options: { getKey?: (row: Row) => string; pageSize?: number } = {},
): Promise<Row[]> {
  const pageSize = options.pageSize ?? REPORT_FETCH_PAGE_SIZE;
  const rows: Row[] = [];
  const seen = new Set<string>();
  let offset = 0;
  let total: number | null = null;

  while (total === null || offset < total) {
    if (offset >= REPORT_FETCH_MAX_ROWS) {
      throw new ApiError(
        400,
        "BAD_REQUEST",
        "El rango tiene demasiados registros para calcularlo de una vez. Acorta el rango de fechas.",
      );
    }

    const { count, data, error, status } = await fetchPage(offset, offset + pageSize - 1);

    // El total era múltiplo exacto de lo leído: la página empieza más allá del final.
    if (isRangeNotSatisfiable(error, status)) {
      break;
    }

    throwIfSupabaseError(error);

    const page = data ?? [];

    if (page.length === 0) {
      break;
    }

    for (const row of page) {
      const key = options.getKey?.(row);

      if (key === undefined) {
        rows.push(row);
      } else if (!seen.has(key)) {
        seen.add(key);
        rows.push(row);
      }
    }

    offset += page.length;

    if (typeof count === "number") {
      total = count;
    }
  }

  return rows;
}

/**
 * Página de una lista con conteo exacto. Una página más allá del total
 * (PostgREST 416 / `PGRST103`) no es un error: se vuelve a contar con los
 * mismos filtros y se responde `items: []` con el `total` real, para que la UI
 * pueda volver a la primera página en vez de mostrar "sin registros".
 */
export async function fetchCountedPage<Row>(input: {
  count: () => PromiseLike<{ count: number | null; error: { code?: string; message?: string } | null }>;
  rows: () => PromiseLike<RowsPage<Row>>;
}): Promise<{ rows: Row[]; total: number }> {
  const { count, data, error, status } = await input.rows();

  if (isRangeNotSatisfiable(error, status)) {
    const recount = await input.count();
    throwIfSupabaseError(recount.error);

    return { rows: [], total: recount.count ?? 0 };
  }

  throwIfSupabaseError(error);

  return { rows: data ?? [], total: count ?? 0 };
}
