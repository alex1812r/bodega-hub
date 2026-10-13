"use client";

import { CollapsibleSection } from "@/shared/components/CollapsibleSection";
import type { PaymentMethod } from "@/shared/mocks/erp-data";
import { PaymentFormFields, type PaymentFormValues } from "@/shared/payments/PaymentFormFields";

import { purchasePaymentBalance } from "../utils/purchaseInitialPayment";

type PurchasePaymentSectionProps = {
  /** Motivo por el que el pago no puede enviarse todavía; se anuncia dentro de la sección. */
  error?: string | null;
  /** Métodos de pago habilitados en la tienda. */
  methods: readonly PaymentMethod[];
  onOpenChange: (open: boolean) => void;
  onValuesChange: (values: PaymentFormValues) => void;
  /** Cerrada (por defecto) la compra se confirma sin pago, aunque haya datos tecleados. */
  open: boolean;
  /** Tasa Bs por REF de la compra en curso. */
  rateVes: number;
  /** Muestra las validaciones por campo: tras intentar confirmar con la sección abierta. */
  showErrors?: boolean;
  /** Total de la compra en curso: es el saldo que ofrece "Completar saldo". */
  totalVes: number;
  values: PaymentFormValues;
};

/**
 * "Pagar ahora": pago inicial opcional de la compra que se está creando, con los
 * mismos campos, métodos y validaciones que el modal de pago (`PaymentFormFields`).
 * El pago se registra al confirmar la compra, justo después de crearla.
 */
export function PurchasePaymentSection({
  error = null,
  methods,
  onOpenChange,
  onValuesChange,
  open,
  rateVes,
  showErrors = false,
  totalVes,
  values,
}: PurchasePaymentSectionProps) {
  const balance = purchasePaymentBalance(totalVes, rateVes);

  return (
    <CollapsibleSection
      className="min-w-0 rounded-xl shadow-sm"
      onOpenChange={onOpenChange}
      open={open}
      summary="Opcional: registra el pago al confirmar la compra."
      title="Pagar ahora"
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-on-surface-variant">
          El pago se registra al confirmar la compra, por el total o por una parte.
        </p>
        <PaymentFormFields
          methods={methods}
          onChange={onValuesChange}
          overpayToleranceVes={balance.overpayToleranceVes}
          pendingBalance={balance.pendingBalance}
          rateVes={balance.rateVes}
          showErrors={showErrors}
          values={values}
        />
        {error ? (
          <p className="text-sm font-medium text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </CollapsibleSection>
  );
}
