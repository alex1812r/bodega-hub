import { DetailSection } from "@/shared/components/DetailSection";
import { Input } from "@/shared/components/Input";
import { SelectField } from "@/shared/components/SelectField";
import type { ContactMock } from "@/shared/mocks/erp-data";
import { formatVes } from "@/shared/utils/currency";

type PurchaseSupplierCardProps = {
  isRateLoading?: boolean;
  onRateChange?: (rate: number) => void;
  onSupplierChange?: (supplierId: string) => void;
  rateVes?: number;
  selectedSupplierId?: string;
  suppliers?: ContactMock[];
};

export function PurchaseSupplierCard({
  isRateLoading = false,
  onRateChange,
  onSupplierChange,
  rateVes = 510,
  selectedSupplierId = "",
  suppliers = [],
}: PurchaseSupplierCardProps) {
  return (
    <DetailSection
      description="Selecciona el proveedor y datos base de la compra."
      title="Proveedor"
    >
      <div className="grid gap-4 md:grid-cols-3">
        <SelectField
          label="Proveedor"
          onChange={(event) => onSupplierChange?.(event.target.value)}
          options={suppliers.map((supplier) => ({
            label: supplier.name,
            value: supplier.id,
          }))}
          placeholder="Selecciona proveedor"
          value={selectedSupplierId}
        />
        <SelectField
          label="Estado"
          options={[
            { label: "Recibido", value: "recibido" },
            { label: "Pedido", value: "pedido" },
          ]}
          placeholder="Selecciona estado"
          defaultValue="recibido"
          disabled
        />
        <Input
          helperText={isRateLoading ? "Consultando tasa vigente..." : `Tasa actual: ${formatVes(rateVes)}`}
          label="Tasa ref/VES"
          min="0"
          onChange={(event) => onRateChange?.(Number(event.target.value))}
          step="0.01"
          type="number"
          value={rateVes}
        />
      </div>
    </DetailSection>
  );
}
