import { Badge } from "@/shared/components/Badge";
import { DetailSection } from "@/shared/components/DetailSection";
import { InfoGrid } from "@/shared/components/InfoGrid";
import { formatRef, formatVes } from "@/shared/utils/currency";

export type PaymentMethodDetails = {
  amountRef: number;
  amountVes: number;
  bankName?: string;
  currency: "VES" | "USD";
  method: "efectivo_ves" | "efectivo_usd" | "pago_movil" | "punto_venta" | "transferencia";
  phone?: string;
  referenceCode?: string;
};

type PaymentMethodDetailsCardProps = {
  payment: PaymentMethodDetails;
};

const methodLabels: Record<PaymentMethodDetails["method"], string> = {
  efectivo_ves: "Efectivo VES",
  efectivo_usd: "Efectivo USD",
  pago_movil: "Pago movil",
  punto_venta: "Punto de venta",
  transferencia: "Transferencia",
};

export function PaymentMethodDetailsCard({ payment }: PaymentMethodDetailsCardProps) {
  return (
    <DetailSection
      description="Datos visuales del metodo, moneda y referencia del pago."
      title="Detalle del pago"
    >
      <InfoGrid
        items={[
          { label: "Metodo", value: methodLabels[payment.method] },
          { label: "Moneda", value: <Badge variant="info">{payment.currency}</Badge> },
          { label: "Monto ref", value: formatRef(payment.amountRef) },
          { label: "Monto VES", value: formatVes(payment.amountVes) },
          { label: "Banco", value: payment.bankName ?? "No aplica" },
          { label: "Telefono", value: payment.phone ?? "No aplica" },
          { label: "Referencia", value: payment.referenceCode ?? "No aplica" },
        ]}
      />
    </DetailSection>
  );
}
