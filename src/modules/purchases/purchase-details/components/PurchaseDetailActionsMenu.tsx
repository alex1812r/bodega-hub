"use client";

import { useMemo, useState } from "react";

import { usePermission } from "@/shared/auth/usePermission";
import {
  ActionsMenu,
  type ActionMenuItem,
} from "@/shared/components/ActionsMenu";
import { Button } from "@/shared/components/Button";
import { Modal } from "@/shared/components/Modal";
import type { PurchaseStatus } from "@/shared/mocks/erp-data";

type PurchaseDetailActionId = "cancel" | "pdf" | "return";

type PurchaseDetailActionsMenuProps = {
  isCancelling?: boolean;
  isExportingPdf?: boolean;
  isReturning?: boolean;
  onCancel: () => void | Promise<void>;
  onExportPdf: () => void | Promise<void>;
  onReturn: () => void | Promise<void>;
  purchaseNumber: string;
  status: PurchaseStatus;
};

type ActionConfig = {
  confirmLabel: string;
  confirmVariant?: "danger" | "default";
  description: string;
  title: string;
};

const actionConfigs: Record<PurchaseDetailActionId, ActionConfig> = {
  cancel: {
    confirmLabel: "Confirmar anulación",
    confirmVariant: "danger",
    description:
      "La orden quedará cancelada y no modificará el inventario. Los montos pagados deberán conciliarse manualmente.",
    title: "Cancelar compra",
  },
  pdf: {
    confirmLabel: "Descargar PDF",
    description:
      "Se descargará un PDF con los datos actuales de la compra, incluyendo ítems y totales.",
    title: "Confirmar impresión",
  },
  return: {
    confirmLabel: "Confirmar devolución",
    confirmVariant: "danger",
    description:
      "Se revertirá el stock asociado a esta compra. Verifica inventario y pagos con el proveedor.",
    title: "Devolver compra",
  },
};

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
  const { can } = usePermission();
  const [pendingAction, setPendingAction] = useState<PurchaseDetailActionId | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  const canMutate = status !== "cancelado" && status !== "devuelto";
  const pendingConfig = pendingAction ? actionConfigs[pendingAction] : null;

  const actions = useMemo(() => {
    const menuActions: ActionMenuItem[] = [];

    menuActions.push({
      disabled: isExportingPdf,
      label: isExportingPdf ? "Generando PDF..." : "Descargar PDF",
      onSelect: () => setPendingAction("pdf"),
    });

    if (can("purchases.create")) {
      menuActions.push({
        disabled: !canMutate || isReturning,
        label: isReturning ? "Procesando..." : "Devolver",
        onSelect: () => setPendingAction("return"),
        variant: "danger",
      });
      menuActions.push({
        disabled: !canMutate || isCancelling,
        label: isCancelling ? "Cancelando..." : "Cancelar",
        onSelect: () => setPendingAction("cancel"),
        variant: "danger",
      });
    }

    return menuActions;
  }, [
    can,
    canMutate,
    isCancelling,
    isExportingPdf,
    isReturning,
  ]);

  async function handleConfirm() {
    if (!pendingAction) {
      return;
    }

    setIsConfirming(true);

    try {
      switch (pendingAction) {
        case "cancel":
          await onCancel();
          break;
        case "pdf":
          await onExportPdf();
          break;
        case "return":
          await onReturn();
          break;
      }

      setPendingAction(null);
    } finally {
      setIsConfirming(false);
    }
  }

  if (actions.length === 0) {
    return null;
  }

  return (
    <>
      <ActionsMenu actions={actions} label={`Acciones de ${purchaseNumber}`} />

      <Modal
        description={pendingConfig?.description}
        footer={({ close }) => (
          <>
            <Button disabled={isConfirming} onClick={close} type="button" variant="outline">
              Cerrar
            </Button>
            <Button
              disabled={isConfirming}
              onClick={() => void handleConfirm()}
              type="button"
              variant={pendingConfig?.confirmVariant === "danger" ? "danger" : "primary"}
            >
              {isConfirming ? "Procesando..." : pendingConfig?.confirmLabel}
            </Button>
          </>
        )}
        onOpenChange={(open) => {
          if (!open && !isConfirming) {
            setPendingAction(null);
          }
        }}
        open={pendingAction !== null}
        title={pendingConfig?.title ?? "Confirmar acción"}
      >
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Compra {purchaseNumber}
        </p>
      </Modal>
    </>
  );
}
