import { z } from "zod";

import { listParams } from "@/shared/hooks/useUrlListState";

/** Pestañas del detalle de producto; la activa va en `?tab=` (sin parámetro = Resumen). */
export const PRODUCT_DETAIL_TAB_PARAM = "tab";

export type ProductDetailTab = "resumen" | "proveedores" | "historial" | "avanzado";

/**
 * Página y tamaño del historial de ventas en la URL del detalle (regla 15).
 * El detalle tiene dos listas, así que cada una usa sus propios parámetros.
 */
export const productSalesHistorySchema = z.object({
  salesPage: listParams.page(),
  salesLimit: listParams.limit(),
});

/** Página y tamaño del historial de precios en la URL del detalle. */
export const productPriceHistorySchema = z.object({
  pricesPage: listParams.page(),
  pricesLimit: listParams.limit(),
});
