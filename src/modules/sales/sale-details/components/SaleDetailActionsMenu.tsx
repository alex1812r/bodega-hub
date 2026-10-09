"use client";

import { useMemo } from "react";

import { usePermission } from "@/shared/auth/usePermission";
import { ActionsMenu, type ActionMenuItem } from "@/shared/components/ActionsMenu";
import type { SaleStatus } from "@/shared/mocks/erp-data";

type SaleDetailActionsMenuProps = {
  isCancelling?: boolean;
  isExportingPdf?: boolean;
  isReturning?: boolean;
  /** Pide anular: quien monta el menú abre la confirmación con el efecto. */
  onCancel: () => void;
  onDownloadPdf: () => void | Promise<void>;
  onPrint: () => void;
  /** Pide devolver: quien monta el menú abre la confirmación con el efecto. */
  onReturn: () => void;
  status: SaleStatus;
};

/**
 * Menú "…" del detalle de venta. Imprimir y descargar son inofensivas y se
 * ejecutan directo; anular y devolver solo piden su confirmación
 * (`SaleCancelConfirmModal` / `SaleReturnConfirmModal`), que es quien ejecuta.
 */
export function SaleDetailActionsMenu({
  isCancelling = false,
  isExportingPdf = false,
  isReturning = false,
  onCancel,
  onDownloadPdf,
  onPrint,
  onReturn,
  status,
}: SaleDetailActionsMenuProps) {
  const { can } = usePermission();

  const actions = useMemo(() => {
    const items: ActionMenuItem[] = [
      {
        label: "Imprimir factura",
        onSelect: onPrint,
      },
      {
        disabled: isExportingPdf,
        label: "Descargar PDF",
        onSelect: () => void onDownloadPdf(),
      },
    ];

    if (can("sales.create")) {
      // `cancel_sale` y `return_sale` solo aceptan ventas vivas: una anulada,
      // devuelta o en borrador no ofrece ninguna de las dos.
      const isLive = status === "pagada" || status === "pendiente_pago";
      const isBusy = isCancelling || isReturning;

      items.push(
        {
          disabled: isBusy || !isLive,
          label: "Devolución",
          onSelect: onReturn,
        },
        {
          disabled: isBusy || !isLive,
          label: "Anular venta",
          onSelect: onCancel,
          variant: "danger",
        },
      );
    }

    return items;
  }, [
    can,
    isCancelling,
    isExportingPdf,
    isReturning,
    onCancel,
    onDownloadPdf,
    onPrint,
    onReturn,
    status,
  ]);

  return <ActionsMenu actions={actions} label="Acciones de la venta" />;
}
