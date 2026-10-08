import { z } from "zod";

import type { PaymentMethod } from "@/shared/mocks/erp-data";
import { listParams, type UrlListStateOf } from "@/shared/hooks/useUrlListState";

import type { PaymentsFilters } from "../../hooks/usePayments";

export const PAYMENT_METHOD_FILTER_VALUES = [
  "efectivo_usd",
  "efectivo_ves",
  "pago_movil",
  "punto_venta",
  "transferencia",
] as const satisfies readonly PaymentMethod[];

/** Los ids de enlace profundo no se teclean: llegan en el enlace de otra pantalla. */
const MAX_DEEP_LINK_ID_LENGTH = 120;

/**
 * Estado de `/payments` en la URL. `saleId`, `purchaseId` y `contactId` son
 * enlaces profundos (detalle de venta, compra o contacto): se muestran como
 * chips quitables, nunca como campos.
 */
export const paymentsListSchema = z.object({
  contactId: listParams.text(MAX_DEEP_LINK_ID_LENGTH),
  direction: listParams.oneOf(["all", "entrada", "salida"], "all"),
  from: listParams.date(),
  limit: listParams.limit(),
  method: listParams.oneOf(["all", ...PAYMENT_METHOD_FILTER_VALUES], "all"),
  page: listParams.page(),
  purchaseId: listParams.text(MAX_DEEP_LINK_ID_LENGTH),
  saleId: listParams.text(MAX_DEEP_LINK_ID_LENGTH),
  to: listParams.date(),
});

export type PaymentsListState = UrlListStateOf<typeof paymentsListSchema.shape>;

/** Patch que deja la lista sin filtros (no toca el tamaño de página). */
export const CLEARED_PAYMENTS_FILTERS = {
  contactId: "",
  direction: "all",
  from: "",
  method: "all",
  purchaseId: "",
  saleId: "",
  to: "",
} as const satisfies Partial<PaymentsListState>;

/**
 * Filtros que viajan a `GET /api/payments`. Con `salePaymentsOnly` (vendedor)
 * solo hay entradas de venta: se fuerza `entrada` y se ignora `purchaseId`.
 */
export function toPaymentsFilters(
  state: PaymentsListState,
  salePaymentsOnly: boolean,
): PaymentsFilters {
  const direction = state.direction === "all" ? undefined : state.direction;

  return {
    contactId: state.contactId || undefined,
    direction: salePaymentsOnly ? "entrada" : direction,
    from: state.from || undefined,
    method: state.method === "all" ? undefined : state.method,
    purchaseId: salePaymentsOnly ? undefined : state.purchaseId || undefined,
    saleId: state.saleId || undefined,
    to: state.to || undefined,
  };
}

/** `true` si hay algún filtro que "Limpiar filtros" pueda quitar. */
export function hasActivePaymentsFilters(state: PaymentsListState, salePaymentsOnly: boolean) {
  return Boolean(
    state.contactId ||
      state.saleId ||
      state.from ||
      state.to ||
      state.method !== "all" ||
      (!salePaymentsOnly && (state.purchaseId || state.direction !== "all")),
  );
}
