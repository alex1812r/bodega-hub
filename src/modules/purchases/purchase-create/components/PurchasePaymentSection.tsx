import { DetailSection } from "@/shared/components/DetailSection";
import { Input } from "@/shared/components/Input";
import { SelectField } from "@/shared/components/SelectField";
import type { PaymentMethod } from "@/shared/mocks/erp-data";

export type PurchaseInitialPayment = {
  amount: number;
  method: PaymentMethod | "";
  referenceCode: string;
};

type PurchasePaymentSectionProps = {
  payment?: PurchaseInitialPayment;
  onPaymentChange?: (payment: PurchaseInitialPayment) => void;
};

const defaultPayment: PurchaseInitialPayment = {
  amount: 0,
  method: "",
  referenceCode: "",
};

export function PurchasePaymentSection({
  onPaymentChange,
  payment = defaultPayment,
}: PurchasePaymentSectionProps) {
  function updatePayment(input: Partial<PurchaseInitialPayment>) {
    onPaymentChange?.({ ...payment, ...input });
  }

  return (
    <DetailSection
      description="Pago inicial opcional. El registro contable queda para la ola de Pagos."
      title="Pago inicial"
    >
      <div className="grid gap-4 md:grid-cols-3">
        <SelectField
          label="Metodo"
          onChange={(event) =>
            updatePayment({ method: event.target.value as PaymentMethod | "" })
          }
          options={[
            { label: "Efectivo VES", value: "efectivo_ves" },
            { label: "Efectivo USD", value: "efectivo_usd" },
            { label: "Transferencia", value: "transferencia" },
          ]}
          placeholder="Sin pago inicial"
          value={payment.method}
        />
        <Input
          label="Monto"
          min="0"
          onChange={(event) => updatePayment({ amount: Number(event.target.value) })}
          placeholder="0.00"
          type="number"
          value={payment.amount}
        />
        <Input
          label="Referencia"
          onChange={(event) => updatePayment({ referenceCode: event.target.value })}
          placeholder="Numero o codigo"
          value={payment.referenceCode}
        />
      </div>
    </DetailSection>
  );
}
