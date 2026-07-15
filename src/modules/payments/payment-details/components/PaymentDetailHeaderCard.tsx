"use client";

import { Plus, XCircle } from "lucide-react";
import { type ReactNode } from "react";

import { Can } from "@/shared/auth/Can";
import { Button } from "@/shared/components/Button";
import type { PaymentStatus } from "@/shared/mocks/erp-data";

import { PaymentDetailStatusBadge } from "./PaymentDetailStatusBadge";
import { formatPaymentHeading } from "../utils/paymentDetailLabels";

type PaymentDetailHeaderCardProps = {
  isCancelling?: boolean;
  onCancel?: () => void;
  paymentId: string;
  registerPaymentAction?: ReactNode;
  status?: PaymentStatus;
};

export function PaymentDetailHeaderCard({
  isCancelling = false,
  onCancel,
  paymentId,
  registerPaymentAction,
  status = "activo",
}: PaymentDetailHeaderCardProps) {
  const isCancelled = status === "anulado";

  return (
    <header className="flex flex-col gap-4 rounded-xl border border-border bg-surface-container-lowest p-6 shadow-sm md:flex-row md:items-center md:justify-between dark:border-slate-800">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="break-all font-mono text-sm font-semibold text-foreground md:text-base">
            {formatPaymentHeading(paymentId)}
          </h2>
          <PaymentDetailStatusBadge status={status} />
        </div>
        <p className="mt-1 text-sm text-on-surface-variant">
          {isCancelled
            ? "Este pago fue anulado y ya no cuenta en el saldo del documento."
            : "Registro confirmado y vinculado al documento origen."}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Can permission="payments.manage">
          {!isCancelled ? (
            <Button
              className="gap-2 text-destructive hover:bg-red-50 hover:text-destructive dark:hover:bg-red-950/40"
              disabled={isCancelling}
              onClick={onCancel}
              size="sm"
              type="button"
              variant="outline"
            >
              <XCircle aria-hidden className="size-[1.125rem]" />
              {isCancelling ? "Anulando..." : "Anular pago"}
            </Button>
          ) : null}
          {registerPaymentAction ?? (
            <Button className="gap-2 shadow-sm" disabled size="sm" type="button">
              <Plus aria-hidden className="size-[1.125rem]" />
              Registrar otro pago
            </Button>
          )}
        </Can>
      </div>
    </header>
  );
}
