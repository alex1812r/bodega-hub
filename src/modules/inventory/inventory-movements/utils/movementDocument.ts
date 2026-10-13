import type {
  MovementDocumentKind,
  MovementDocumentKindFilter,
} from "../../utils/inventoryMovementFilters";

/** Lo que un movimiento dice de su documento (listado, kardex, exportación). */
export type MovementDocumentSource = {
  conversionId?: string | null;
  documentKind?: MovementDocumentKind | null;
  documentNumber?: string | null;
  purchaseId?: string | null;
  saleId?: string | null;
};

export type MovementDocument = {
  /** Ruta del detalle de la venta o compra; una conversión o un ajuste no tienen. */
  href?: string;
  kind: MovementDocumentKind | null;
  /** Número del documento o, si no hay, el nombre de su tipo. */
  label: string;
};

export const MANUAL_ADJUSTMENT_LABEL = "Ajuste manual";
export const PACK_CONVERSION_LABEL = "Conversión de empaque";

/** Tipos de documento del filtro, en el orden en que se ofrecen. */
export const movementDocumentKindOptions: ReadonlyArray<{
  label: string;
  value: MovementDocumentKindFilter;
}> = [
  { label: "Venta", value: "venta" },
  { label: "Compra", value: "compra" },
  { label: "Conversión", value: "conversion" },
  { label: MANUAL_ADJUSTMENT_LABEL, value: "sin_documento" },
];

/**
 * Documento de un movimiento. `documentKind` solo viene en
 * `/api/inventory/movements`; si falta, sale de los vínculos del movimiento.
 * Sin venta, compra ni conversión es un "Ajuste manual". Una venta o compra sin
 * número (la base no devolvió el documento) se muestra por su tipo.
 */
export function resolveMovementDocument(movement: MovementDocumentSource): MovementDocument {
  const kind =
    movement.documentKind ??
    (movement.saleId
      ? "venta"
      : movement.purchaseId
        ? "compra"
        : movement.conversionId
          ? "conversion"
          : null);
  const number = movement.documentNumber?.trim();

  if (kind === "venta") {
    return {
      href: movement.saleId ? `/sales/${movement.saleId}` : undefined,
      kind,
      label: number || "Venta",
    };
  }

  if (kind === "compra") {
    return {
      href: movement.purchaseId ? `/purchases/${movement.purchaseId}` : undefined,
      kind,
      label: number || "Compra",
    };
  }

  if (kind === "conversion") {
    return { kind, label: PACK_CONVERSION_LABEL };
  }

  return { kind: null, label: MANUAL_ADJUSTMENT_LABEL };
}
