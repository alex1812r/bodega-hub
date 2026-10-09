"use client";

import Link from "next/link";

import { usePermission } from "@/shared/auth/usePermission";

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
 * detalle, "Conversión de empaque" o "Ajuste manual". Una devolución enlaza a
 * la venta o compra que devuelve. Sin permiso para ver ese documento
 * (`sales.view` / `purchases.view`) el número va en texto plano; una conversión
 * y un ajuste no tienen pantalla propia.
 */
export function InventoryMovementDocumentCell({
  movement,
  returnTo,
}: InventoryMovementDocumentCellProps) {
  const { can } = usePermission();
  const document = resolveMovementDocument(movement);
  const canOpen = can(document.kind === "venta" ? "sales.view" : "purchases.view");

  if (!document.href || !canOpen) {
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
