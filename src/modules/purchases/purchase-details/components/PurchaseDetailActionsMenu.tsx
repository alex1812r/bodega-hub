"use client";

import { usePathname } from "next/navigation";
import { useMemo } from "react";

import { usePermission } from "@/shared/auth/usePermission";
import {
  ActionsMenu,
  type ActionMenuItem,
} from "@/shared/components/ActionsMenu";
import type { PurchaseStatus } from "@/shared/mocks/erp-data";

import { getPurchaseActions } from "../../utils/purchaseActions";

type PurchaseDetailActionsMenuProps = {
  isCancelling?: boolean;
  isExportingPdf?: boolean;
  isReturning?: boolean;
  /** Abre la confirmación de cancelar (con su efecto); no cancela. */
  onCancel: () => void;
  /** Descarga el PDF directamente: es inofensivo, no confirma. */
  onExportPdf: () => void | Promise<void>;
  /** Abre la confirmación de devolver (con su efecto); no devuelve. */
  onReturn: () => void;
  purchaseNumber: string;
  status: PurchaseStatus;
};

/**
 * Menú "…" del detalle de compra. PDF y duplicar son directos. Cancelar y
 * devolver solo se ofrecen en los estados que su RPC acepta (cancelar: pedido o
 * recibido; devolver: recibido) y abren su confirmación con el efecto; una
 * compra cancelada o devuelta no ofrece ninguna de las dos.
 */
export function PurchaseDetailActionsMenu({
  isCancelling = false,
  isExportingPdf = false,
  isReturning = false,
  onCancel,
  onExportPdf,
  onReturn,
  purchaseNumber,
  status,
}: PurchaseDetailActionsMenuProps) {
  const { can, role } = usePermission();
  // El detalle vive en `/purchases/[id]`: el id de la compra es el último tramo de la ruta.
  const purchaseId = usePathname().split("/").filter(Boolean).at(-1);

  // Mismas reglas de permiso y de estado que el menú de fila de la lista.
  const { canCancelOrReturn, canDuplicate, isOpen } = getPurchaseActions({ status }, { can, role });
  const canCancel = canCancelOrReturn && isOpen;
  const canReturn = canCancel && status === "recibido";

  const actions = useMemo(() => {
    const menuActions: ActionMenuItem[] = [];

    menuActions.push({
      disabled: isExportingPdf,
      label: isExportingPdf ? "Generando PDF..." : "Descargar PDF",
      onSelect: () => void onExportPdf(),
    });

    // Duplicar vale en cualquier estado: crea otra compra, no toca esta.
    if (canDuplicate && purchaseId) {
      menuActions.push({
        href: `/purchases/create?duplicate=${encodeURIComponent(purchaseId)}`,
        label: "Duplicar compra",
      });
    }

    if (canReturn) {
      menuActions.push({
        disabled: isReturning,
        label: isReturning ? "Procesando..." : "Devolver",
        onSelect: onReturn,
        variant: "danger",
      });
    }

    if (canCancel) {
      menuActions.push({
        disabled: isCancelling,
        label: isCancelling ? "Cancelando..." : "Cancelar",
        onSelect: onCancel,
        variant: "danger",
      });
    }

    return menuActions;
  }, [
    canCancel,
    canDuplicate,
    canReturn,
    isCancelling,
    isExportingPdf,
    isReturning,
    onCancel,
    onExportPdf,
    onReturn,
    purchaseId,
  ]);

  return <ActionsMenu actions={actions} label={`Acciones de ${purchaseNumber}`} />;
}
