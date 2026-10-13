import { z } from "zod";

import { listParams } from "@/shared/hooks/useUrlListState";

import { SUPPLIER_PRODUCT_SORT_COLUMNS } from "../../services/supplierProductSort";

/** Pestañas del detalle de contacto; la activa va en `?tab=` (sin parámetro = Actividad). */
export const CONTACT_DETAIL_TAB_PARAM = "tab";

export type ContactDetailTab =
  | "actividad"
  | "ventas"
  | "compras"
  | "pagos"
  | "saldos"
  | "productos";

/**
 * Página y tamaño de cada sublista en la URL del detalle (regla 15). El detalle
 * tiene varias listas, así que cada una usa sus propios parámetros: cambiar la
 * página de una no mueve las demás.
 */
export const contactActivityListSchema = z.object({
  activityPage: listParams.page(),
  activityLimit: listParams.limit(),
});

export const contactSalesListSchema = z.object({
  salesPage: listParams.page(),
  salesLimit: listParams.limit(),
});

export const contactPurchasesListSchema = z.object({
  purchasesPage: listParams.page(),
  purchasesLimit: listParams.limit(),
});

export const contactPaymentsListSchema = z.object({
  paymentsPage: listParams.page(),
  paymentsLimit: listParams.limit(),
});

/** Búsqueda, filtro, orden y página de "Productos que maneja" (proveedor). */
export const contactProductsListSchema = z.object({
  productsSearch: listParams.text(),
  productsActive: listParams.boolean(true),
  productsSort: listParams.sort(SUPPLIER_PRODUCT_SORT_COLUMNS, "updatedAt"),
  productsDir: listParams.dir("desc"),
  productsPage: listParams.page(),
  productsLimit: listParams.limit(),
});
