import { Badge } from "@/shared/components/Badge";
import { DetailSection } from "@/shared/components/DetailSection";
import { InfoGrid } from "@/shared/components/InfoGrid";
import { formatRef } from "@/shared/utils/currency";

export type ProductSummary = {
  category: string;
  costRef: number;
  name: string;
  priceRef: number;
  sku: string;
  status: "activo" | "inactivo";
};

type ProductSummaryCardProps = {
  product: ProductSummary;
};

export function ProductSummaryCard({ product }: ProductSummaryCardProps) {
  return (
    <DetailSection
      description="Datos principales usados para vender y reponer el producto."
      title={product.name}
    >
      <InfoGrid
        items={[
          { label: "SKU", value: product.sku },
          { label: "Categoria", value: product.category },
          { label: "Precio venta", value: formatRef(product.priceRef) },
          { label: "Costo actual", value: formatRef(product.costRef) },
          {
            label: "Margen ref",
            value: formatRef(product.priceRef - product.costRef),
          },
          {
            label: "Estado",
            value: (
              <Badge variant={product.status === "activo" ? "success" : "default"}>
                {product.status}
              </Badge>
            ),
          },
        ]}
      />
    </DetailSection>
  );
}
