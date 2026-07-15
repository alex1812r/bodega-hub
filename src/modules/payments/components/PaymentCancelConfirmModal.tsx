"use client";

import { Button } from "@/shared/components/Button";
import { Modal } from "@/shared/components/Modal";

import { formatPaymentHeading } from "../payment-details/utils/paymentDetailLabels";

type PaymentCancelConfirmModalProps = {
  isConfirming?: boolean;
  onConfirm: () => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  paymentId: string;
};

export function PaymentCancelConfirmModal({
  isConfirming = false,
  onConfirm,
  onOpenChange,
  open,
  paymentId,
}: PaymentCancelConfirmModalProps) {
  return (
    <Modal
      description="El pago quedara marcado como anulado y se ajustara el saldo del documento vinculado. Esta accion no se puede deshacer."
      footer={({ close }) => (
        <>
          <Button disabled={isConfirming} onClick={close} type="button" variant="outline">
            Cancelar
          </Button>
          <Button
            disabled={isConfirming}
            onClick={() => void onConfirm()}
            type="button"
            variant="danger"
          >
            {isConfirming ? "Procesando..." : "Anular pago"}
          </Button>
        </>
      )}
      onOpenChange={onOpenChange}
      open={open}
      title="Confirmar anulacion"
    >
      <p className="text-sm text-on-surface-variant">
        Pago {formatPaymentHeading(paymentId)}
      </p>
    </Modal>
  );
}
