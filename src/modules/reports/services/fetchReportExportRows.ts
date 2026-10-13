import { MAX_PAGE_LIMIT, type PaginatedList } from "@/lib/api/pagination";
import { EXPORT_MAX_ROWS, type ExportRows } from "@/modules/inventory/services/fetchExportRows";
import { apiFetch } from "@/shared/api/apiFetch";

type QueryValue = boolean | null | number | string | undefined;

/**
 * `fetchExportRows` de Inventario para listas cuyas filas no traen `id` (un día,
 * un cliente, un método de pago…): mismas garantías y mismo tope
 * (`EXPORT_MAX_ROWS`), con la identidad de la fila dada por `getKey`.
 *
 * - Sin filas repetidas: la lista se pagina por `skip`; si entra una fila nueva
 *   por delante mientras se exporta, la última de una página vuelve a salir en
 *   la siguiente y se descarta por su clave.
 * - Con tope: nunca más de `maxRows` filas; `truncated` avisa si había más.
 */
export async function fetchKeyedExportRows<T>(
  path: string,
  query: Record<string, QueryValue>,
  getKey: (row: T) => string,
  maxRows = EXPORT_MAX_ROWS,
): Promise<ExportRows<T>> {
  const rows: T[] = [];
  const seenKeys = new Set<string>();
  let skip = 0;
  let total = Number.POSITIVE_INFINITY;

  while (skip < total && rows.length < maxRows) {
    const page = await apiFetch<PaginatedList<T>>(path, {
      query: { ...query, limit: MAX_PAGE_LIMIT, skip },
    });

    total = page.total;

    if (page.items.length === 0) {
      break;
    }

    for (const item of page.items) {
      const key = getKey(item);

      if (rows.length < maxRows && !seenKeys.has(key)) {
        seenKeys.add(key);
        rows.push(item);
      }
    }

    skip += page.items.length;
  }

  const knownTotal = Number.isFinite(total) ? total : rows.length;

  return { rows, total: knownTotal, truncated: rows.length >= maxRows && knownTotal > maxRows };
}
