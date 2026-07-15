"use client";

import { useMemo, useState } from "react";

import { usePermission } from "@/shared/auth/usePermission";
import { ActionsMenu, type ActionMenuItem } from "@/shared/components/ActionsMenu";
import { Button } from "@/shared/components/Button";
import { Modal } from "@/shared/components/Modal";
import type { SaleStatus } from "@/shared/mocks/erp-data";

import { formatInvoiceHeading } from "../utils/saleDetailLabels";

type PendingAction = "cancel" | "pdf" | "print" | "return";

type SaleDetailActionsMenuProps = {
  invoiceNumber: string;
  isCancelling?: boolean;
  isExportingPdf?: boolean;
  isReturning?: boolean;
  onCancel: () => void | Promise<void>;
  onDownloadPdf: () => void | Promise<void>;
  onPrint: () => void;
  onReturn: () => void | Promise<void>;
  saleId: string;
  status: SaleStatus;
};

const actionModalCopy: Record<
  PendingAction,
  {
    confirmLabel: string;
    description: string;
    title: string;
    variant?: "danger" | "primary";
  }
> = {
  cancel: {
    confirmLabel: "Anular venta",
    description:
      "La venta quedara marcada como anulada. Esta accion no se puede deshacer.",
    title: "Confirmar anulacion",
    variant: "danger",
  },
  pdf: {
    confirmLabel: "Descargar PDF",
    description:
      "Se generara la factura en PDF con los datos mas recientes de la venta.",
    title: "Confirmar descarga",
    variant: "primary",
  },
  print: {
    confirmLabel: "Imprimir",
    description: "Se abrira el dialogo de impresion del navegador para esta factura.",
    title: "Confirmar impresion",
    variant: "primary",
  },
  return: {
    confirmLabel: "Registrar devolucion",
    description:
      "Se registrara la devolucion y se restaurara el inventario correspondiente.",
    title: "Confirmar devolucion",
    variant: "danger",
  },
};

export function SaleDetailActionsMenu({
  invoiceNumber,
  isCancelling = false,
  isExportingPdf = false,
  isReturning = false,
  onCancel,
  onDownloadPdf,
  onPrint,
  onReturn,
  saleId,
  status,
}: SaleDetailActionsMenuProps) {
  const { can } = usePermission();
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  const actions = useMemo(() => {
    const items: ActionMenuItem[] = [
      {
        label: "Imprimir factura",
        onSelect: () => setPendingAction("print"),
      },
      {
        label: "Descargar PDF",
        onSelect: () => setPendingAction("pdf"),
      },
    ];

    if (can("sales.create")) {
      items.push(
        {
          disabled: isReturning || status === "devuelta",
          label: "Devolucion",
          onSelect: () => setPendingAction("return"),
        },
        {
          disabled: isCancelling || status === "cancelada",
          label: "Anular venta",
          onSelect: () => setPendingAction("cancel"),
          variant: "danger",
        },
      );
    }

    if (can("payments.manage")) {
      items.push({
        href: `/payments?saleId=${saleId}`,
        label: "Registrar pago",
      });
    }

    return items;
  }, [can, isCancelling, isReturning, saleId, status]);

  async function handleConfirm() {
    if (!pendingAction) {
      return;
    }

    setIsConfirming(true);

    try {
      if (pendingAction === "cancel") {
        await onCancel();
      } else if (pendingAction === "return") {
        await onReturn();
      } else if (pendingAction === "pdf") {
        await onDownloadPdf();
      } else if (pendingAction === "print") {
        onPrint();
      }

      setPendingAction(null);
    } finally {
      setIsConfirming(false);
    }
  }

  const modalCopy = pendingAction ? actionModalCopy[pendingAction] : null;
  const isBusy =
    isConfirming ||
    (pendingAction === "cancel" && isCancelling) ||
    (pendingAction === "return" && isReturning) ||
    (pendingAction === "pdf" && isExportingPdf);

  return (
    <>
      <ActionsMenu actions={actions} label="Acciones de la venta" />

      <Modal
        description={modalCopy?.description}
        footer={({ close }) => (
          <>
            <Button disabled={isBusy} onClick={close} type="button" variant="outline">
              Cancelar
            </Button>
            <Button
              disabled={isBusy}
              onClick={() => void handleConfirm()}
              type="button"
              variant={modalCopy?.variant === "danger" ? "danger" : "primary"}
            >
              {isBusy ? "Procesando..." : modalCopy?.confirmLabel}
            </Button>
          </>
        )}
        onOpenChange={(open) => {
          if (!open) {
            setPendingAction(null);
          }
        }}
        open={pendingAction !== null}
        title={modalCopy?.title ?? "Confirmar accion"}
      >
        <p className="text-sm text-on-surface-variant">
          Factura {formatInvoiceHeading(invoiceNumber)}
        </p>
      </Modal>
    </>
  );
}
