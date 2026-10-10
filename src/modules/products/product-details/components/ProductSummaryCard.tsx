import { Badge } from "@/shared/components/Badge";
import { DetailSection } from "@/shared/components/DetailSection";
import { InfoGrid } from "@/shared/components/InfoGrid";
import { MarginBadge } from "@/shared/components/MarginBadge";
import { formatRef, roundMoney } from "@/shared/utils/currency";

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
          { label: "Categoría", value: product.category },
          { label: "Costo actual", value: formatRef(product.costRef) },
          { label: "Precio venta", value: formatRef(product.priceRef) },
          {
            label: "Ganancia",
            value: (
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <MarginBadge cost={product.costRef} price={product.priceRef} />
                {product.costRef > 0 ? (
                  <span className="tabular-nums">
                    {formatRef(roundMoney(product.priceRef - product.costRef))}
                  </span>
                ) : null}
              </span>
            ),
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
