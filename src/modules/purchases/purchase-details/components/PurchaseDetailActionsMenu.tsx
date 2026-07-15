"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { usePermission } from "@/shared/auth/usePermission";
import {
  ActionsMenu,
  type ActionMenuItem,
} from "@/shared/components/ActionsMenu";
import { Button } from "@/shared/components/Button";
import { Modal } from "@/shared/components/Modal";
import type { PurchaseStatus } from "@/shared/mocks/erp-data";

type PurchaseDetailActionId = "cancel" | "payment" | "pdf" | "receive" | "return";

type PurchaseDetailActionsMenuProps = {
  isCancelling?: boolean;
  isExportingPdf?: boolean;
  isReceiving?: boolean;
  isReturning?: boolean;
  onCancel: () => void | Promise<void>;
  onExportPdf: () => void | Promise<void>;
  onReceive: () => void | Promise<void>;
  onReturn: () => void | Promise<void>;
  purchaseId: string;
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
  payment: {
    confirmLabel: "Ir a pagos",
    description: "Serás redirigido al módulo de pagos para registrar un abono a esta compra.",
    title: "Registrar pago",
  },
  pdf: {
    confirmLabel: "Descargar PDF",
    description:
      "Se descargará un PDF con los datos actuales de la compra, incluyendo ítems y totales.",
    title: "Confirmar impresión",
  },
  receive: {
    confirmLabel: "Confirmar recepción",
    description:
      "La mercancía ingresará al inventario y el estado de la compra pasará a recibido.",
    title: "Recibir pedido",
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
  isReceiving = false,
  isReturning = false,
  onCancel,
  onExportPdf,
  onReceive,
  onReturn,
  purchaseId,
  purchaseNumber,
  status,
}: PurchaseDetailActionsMenuProps) {
  const router = useRouter();
  const { can } = usePermission();
  const [pendingAction, setPendingAction] = useState<PurchaseDetailActionId | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  const canMutate = status !== "cancelado" && status !== "devuelto";
  const pendingConfig = pendingAction ? actionConfigs[pendingAction] : null;

  const actions = useMemo(() => {
    const menuActions: ActionMenuItem[] = [];

    if (can("payments.manage")) {
      menuActions.push({
        label: "Registrar pago",
        onSelect: () => setPendingAction("payment"),
      });
    }

    if (can("purchases.create") && status === "pedido") {
      menuActions.push({
        disabled: isReceiving,
        label: isReceiving ? "Recibiendo..." : "Recibir pedido",
        onSelect: () => setPendingAction("receive"),
      });
    }

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
    isReceiving,
    isReturning,
    status,
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
        case "payment":
          router.push(`/payments?purchaseId=${purchaseId}`);
          break;
        case "pdf":
          await onExportPdf();
          break;
        case "receive":
          await onReceive();
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
