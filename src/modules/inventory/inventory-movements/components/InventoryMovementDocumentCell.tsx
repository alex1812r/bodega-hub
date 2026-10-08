"use client";

import Link from "next/link";

import { withChainedReturnTo } from "../../utils/chainedReturnTo";
import {
  resolveMovementDocument,
  type MovementDocumentSource,
} from "../utils/movementDocument";

type InventoryMovementDocumentCellProps = {
  movement: MovementDocumentSource;
  /**
   * URL de la lista (ruta + query): el detalle del documento vuelve a ella, con
   * el `returnTo` que la lista traiga.
   */
  returnTo?: string;
};

/**
 * Documento de un movimiento: número de la venta o compra con enlace a su
 * detalle, "Conversión de empaque" o "Ajuste manual".
 */
export function InventoryMovementDocumentCell({
  movement,
  returnTo,
}: InventoryMovementDocumentCellProps) {
  const document = resolveMovementDocument(movement);

  if (!document.href) {
    return <span className="text-on-surface-variant">{document.label}</span>;
  }

  return (
    <Link
      className="break-all rounded font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      href={withChainedReturnTo(document.href, returnTo)}
      title={document.kind === "venta" ? "Ver la venta" : "Ver la compra"}
    >
      {document.label}
    </Link>
  );
}
