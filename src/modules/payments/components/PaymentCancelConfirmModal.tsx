"use client";

import {
  ConfirmActionModal,
  type ConfirmActionEffect,
} from "@/shared/components/ConfirmActionModal";

import { formatPaymentHeading } from "../payment-details/utils/paymentDetailLabels";

type PaymentCancelConfirmModalProps = {
  /** Mensaje del rechazo de la anulación; se muestra tal cual dentro del modal. */
  error?: string | null;
  isConfirming?: boolean;
  onConfirm: () => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  paymentId: string;
};

const cancelEffects: ConfirmActionEffect[] = [
  { after: "Anulado", label: "Estado del pago", tone: "danger" },
  { label: "Se ajusta el saldo del documento vinculado", tone: "warning" },
];

export function PaymentCancelConfirmModal({
  error,
  isConfirming = false,
  onConfirm,
  onOpenChange,
  open,
  paymentId,
}: PaymentCancelConfirmModalProps) {
  return (
    <ConfirmActionModal
      confirmLabel="Anular pago"
      description="El pago quedara marcado como anulado y se ajustara el saldo del documento vinculado. Esta accion no se puede deshacer."
      effects={cancelEffects}
      error={error}
      isPending={isConfirming}
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
      open={open}
      title="Confirmar anulacion"
      variant="danger"
    >
      <p>Pago {formatPaymentHeading(paymentId)}</p>
    </ConfirmActionModal>
  );
}
