import { MAX_PAGE_LIMIT, type PaginatedList } from "@/lib/api/pagination";
import { apiFetch } from "@/shared/api/apiFetch";

/** Tope de filas de una exportación a Excel: 200 peticiones con el `limit` máximo del BFF. */
export const EXPORT_MAX_ROWS = 20_000;

type QueryValue = boolean | null | number | string | undefined;

export type ExportRows<T> = {
  rows: T[];
  /** Total que declara el servidor para los filtros (el de la última página leída). */
  total: number;
  /** Hay más filas que el tope: `rows` trae solo las primeras `maxRows` de la lista. */
  truncated: boolean;
};

/**
 * Lee una lista paginada del BFF para exportarla, con dos garantías que el
 * paginador común no da:
 *
 * - Sin filas repetidas. La lista se pagina por `skip`; si entra una fila nueva
 *   por delante mientras se exporta, las siguientes se desplazan y la última de
 *   una página vuelve a salir en la otra. Se descarta por `id`, conservando el
 *   orden de llegada. Las filas creadas durante la exportación pueden no salir:
 *   el endpoint no admite un corte por instante (`to` es un día).
 * - Con tope. Nunca trae más de `maxRows` filas; si la lista es mayor,
 *   `truncated` lo dice para que la pantalla avise al usuario.
 */
export async function fetchExportRows<T extends { id: string }>(
  path: string,
  query: Record<string, QueryValue> = {},
  maxRows = EXPORT_MAX_ROWS,
): Promise<ExportRows<T>> {
  const rows: T[] = [];
  const seenIds = new Set<string>();
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
      if (rows.length < maxRows && !seenIds.has(item.id)) {
        seenIds.add(item.id);
        rows.push(item);
      }
    }

    skip += page.items.length;
  }

  const knownTotal = Number.isFinite(total) ? total : rows.length;

  return { rows, total: knownTotal, truncated: rows.length >= maxRows && knownTotal > maxRows };
}

/** 20000 → "20.000", como se escriben los miles en la interfaz. */
export function formatExportCount(count: number) {
  return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
