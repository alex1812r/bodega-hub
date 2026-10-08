/** Código de PostgREST para un `Range` que empieza más allá del total de filas. */
const RANGE_NOT_SATISFIABLE_CODE = "PGRST103";
const RANGE_NOT_SATISFIABLE_STATUS = 416;

/**
 * La consulta paginada pidió una página más allá del total (`skip` > total con
 * `count: "exact"` y `.range()`): PostgREST responde 416 / `PGRST103`. Para una
 * lista no es un error, es una página vacía: el servicio vuelve a contar con los
 * mismos filtros (`head: true`) y responde `items: []` con el total real.
 */
export function isRangeNotSatisfiable(
  error: { code?: string } | null,
  status: number | undefined,
) {
  return (
    error !== null &&
    (error.code === RANGE_NOT_SATISFIABLE_CODE || status === RANGE_NOT_SATISFIABLE_STATUS)
  );
}

/**
 * Opciones de `select` de una lista: conteo exacto y, para la consulta que solo
 * cuenta (la de después de un rango fuera de total), `head: true`.
 */
export function listCountOptions(head: boolean): { count: "exact"; head?: true } {
  return head ? { count: "exact", head: true } : { count: "exact" };
}
