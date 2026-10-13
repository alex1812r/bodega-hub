/**
 * CRITERIO ÚNICO de "qué es una venta" para reportes, gráficos, rankings, KPI
 * del dashboard, cierre del día, exportes y el asistente (DEC-01).
 *
 * Estados del enum `public.sale_status`: `borrador`, `pendiente_pago`,
 * `pagada`, `cancelada`, `devuelta`.
 *
 * - CUENTAN `pendiente_pago` y `pagada`: son las ventas vivas, las que movieron
 *   stock.
 * - NO CUENTAN `borrador` (no es una venta todavía), `cancelada` ni `devuelta`.
 *
 * Se filtra por la lista POSITIVA (`COUNTED_SALE_STATUSES`): un estado nuevo no
 * cuenta hasta que alguien lo decida aquí. En SQL la misma lista está en las
 * vistas de `supabase/patches/20261018a-reports-exclude-draft-sales.sql`
 * (`status in ('pendiente_pago', 'pagada')`); si cambia aquí, cambia allí y en
 * `docs/modules-catalog.md` («Criterio de estados»).
 */
export const COUNTED_SALE_STATUSES = ["pendiente_pago", "pagada"] as const;

export type CountedSaleStatus = (typeof COUNTED_SALE_STATUSES)[number];

/** Los estados que no son una venta para ningún reporte. */
export const NOT_COUNTED_SALE_STATUSES = ["borrador", "cancelada", "devuelta"] as const;

/** La venta entra en reportes, gráficos, rankings y KPI. */
export function countsAsSale(status: string): status is CountedSaleStatus {
  return (COUNTED_SALE_STATUSES as readonly string[]).includes(status);
}
