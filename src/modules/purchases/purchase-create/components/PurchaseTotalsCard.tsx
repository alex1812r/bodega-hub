import { DetailSection } from "@/shared/components/DetailSection";
import { InfoGrid } from "@/shared/components/InfoGrid";
import { formatRef, formatVes, refToVes } from "@/shared/utils/currency";

type PurchaseTotalsCardProps = {
  discountRef?: number;
  rateVes?: number;
  subtotalRef?: number;
  taxRef?: number;
};

export function PurchaseTotalsCard({
  discountRef = 0,
  rateVes = 510,
  subtotalRef = 60,
  taxRef = 0,
}: PurchaseTotalsCardProps) {
  const totalRef = subtotalRef - discountRef + taxRef;

  return (
    <DetailSection
      description="Resumen de totales calculados para la compra."
      title="Totales"
    >
      <InfoGrid
        items={[
          { label: "Subtotal ref", value: formatRef(subtotalRef) },
          { label: "Descuento ref", value: formatRef(discountRef) },
          { label: "Impuesto ref", value: formatRef(taxRef) },
          { label: "Total ref", value: formatRef(totalRef) },
          { label: "Tasa", value: formatVes(rateVes) },
          { label: "Total VES", value: formatVes(refToVes(totalRef, rateVes)) },
        ]}
      />
    </DetailSection>
  );
}
