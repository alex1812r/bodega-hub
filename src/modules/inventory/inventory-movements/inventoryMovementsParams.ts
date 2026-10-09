import { z } from "zod";

import { listParams, type UrlListStateOf } from "@/shared/hooks/useUrlListState";
import type { StockMovementType } from "@/shared/mocks/erp-data";

import type { MovementsExportFilters } from "./services/fetchMovementsForExport";
import { movementTypeBadgeVariant } from "./utils/movementTypeLabels";

/** Con menos caracteres el filtro de documento no se envía (el servidor acota a los 50 más recientes). */
export const MOVEMENT_DOCUMENT_MIN_LENGTH = 3;

/** Tipo de movimiento: cualquiera de los conocidos; cadena vacía = todos. */
const movementTypeParam = () =>
  z
    .custom<StockMovementType | "">(
      (value) =>
        typeof value === "string" &&
        (value === "" || Object.hasOwn(movementTypeBadgeVariant, value)),
    )
    .default("");

/**
 * Estado de `/inventory/movements` en la URL (regla 15). Sin parámetros = todos
 * los movimientos, página 1.
 *
 * | Parámetro      | Valores                                              | Por defecto  |
 * |----------------|------------------------------------------------------|--------------|
 * | `type`         | tipo de movimiento                                   | `""` = todos |
 * | `from`, `to`   | día de Caracas `YYYY-MM-DD`, inclusive               | `""`         |
 * | `productId`    | id de producto                                       | `""`         |
 * | `document`     | texto del número de venta o compra (con debounce)    | `""`         |
 * | `documentKind` | `venta` · `compra` · `conversion` · `sin_documento`  | `""` = todos |
 * | `saleId`       | id de una venta: solo sus movimientos                | `""`         |
 * | `purchaseId`   | id de una compra: solo sus movimientos               | `""`         |
 * | `page`         | base 1                                               | `1`          |
 * | `limit`        | tamaño de página                                     | `10`         |
 *
 * `saleId` y `purchaseId` no tienen campo en el formulario: llegan en el enlace
 * «Ver movimientos de stock» del detalle de la venta o la compra, y la pantalla
 * avisa de que están puestos y deja quitarlos.
 *
 * `returnTo` queda reservado para "Volver": no es de este schema, así que
 * `useUrlListState` lo conserva sin tocarlo.
 */
export const inventoryMovementsSchema = z.object({
  type: movementTypeParam(),
  from: listParams.date(),
  to: listParams.date(),
  productId: listParams.text(64),
  document: listParams.text(100),
  documentKind: listParams.oneOf(["", "venta", "compra", "conversion", "sin_documento"], ""),
  saleId: listParams.text(64),
  purchaseId: listParams.text(64),
  page: listParams.page(),
  limit: listParams.limit(),
});

export type InventoryMovementsState = UrlListStateOf<typeof inventoryMovementsSchema.shape>;

export type InventoryMovementsFilterState = Omit<InventoryMovementsState, "limit" | "page">;

/** Campos que se escriben en la URL con debounce (los que se teclean). */
export const INVENTORY_MOVEMENTS_TEXT_FIELDS = ["document"] as const;

/** Los filtros en su valor por defecto; `page` y `limit` no son filtros. */
export const INVENTORY_MOVEMENTS_NO_FILTERS: InventoryMovementsFilterState = {
  document: "",
  documentKind: "",
  from: "",
  productId: "",
  purchaseId: "",
  saleId: "",
  to: "",
  type: "",
};

export function hasInventoryMovementsFilters(state: InventoryMovementsFilterState) {
  return (
    state.type !== "" ||
    state.from !== "" ||
    state.to !== "" ||
    state.productId !== "" ||
    state.document.trim() !== "" ||
    state.documentKind !== "" ||
    state.saleId !== "" ||
    state.purchaseId !== ""
  );
}

/** `from` posterior a `to`: el servidor lo rechaza, así que ni se consulta ni se exporta. */
export function isMovementsRangeInverted(state: Pick<InventoryMovementsState, "from" | "to">) {
  return state.from !== "" && state.to !== "" && state.from > state.to;
}

/** El texto de documento es demasiado corto para enviarse. */
export function isMovementDocumentTooShort(document: string) {
  const length = document.trim().length;

  return length > 0 && length < MOVEMENT_DOCUMENT_MIN_LENGTH;
}

/**
 * Estado de la URL → filtros de `GET /api/inventory/movements`, los mismos que
 * usa la exportación. `document` llega ya con su debounce y solo se envía con
 * `MOVEMENT_DOCUMENT_MIN_LENGTH` caracteres o más.
 */
export function toMovementFilters(
  state: Pick<
    InventoryMovementsState,
    "documentKind" | "from" | "productId" | "purchaseId" | "saleId" | "to" | "type"
  >,
  document: string,
): MovementsExportFilters {
  const term = document.trim();

  return {
    document: term.length >= MOVEMENT_DOCUMENT_MIN_LENGTH ? term : undefined,
    documentKind: state.documentKind || undefined,
    from: state.from || undefined,
    productId: state.productId || undefined,
    purchaseId: state.purchaseId || undefined,
    saleId: state.saleId || undefined,
    to: state.to || undefined,
    type: state.type || undefined,
  };
}
