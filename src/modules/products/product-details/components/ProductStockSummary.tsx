import { Badge } from "@/shared/components/Badge";
import { DetailSection } from "@/shared/components/DetailSection";
import { InfoGrid } from "@/shared/components/InfoGrid";

export type ProductStock = {
  lastMovement: string;
  minimumStock: number;
  stock: number;
};

type ProductStockSummaryProps = {
  stock: ProductStock;
};

export function ProductStockSummary({ stock }: ProductStockSummaryProps) {
  const status = stock.stock === 0 ? "agotado" : stock.stock <= stock.minimumStock ? "bajo" : "ok";

  return (
    <DetailSection
      description="Resumen visual del inventario actual del producto."
      title="Inventario"
    >
      <InfoGrid
        items={[
          { label: "Stock actual", value: `${stock.stock} unidades` },
          { label: "Stock minimo", value: `${stock.minimumStock} unidades` },
          { label: "Ultimo movimiento", value: stock.lastMovement },
          {
            label: "Estado",
            value: (
              <Badge
                variant={
                  status === "ok" ? "success" : status === "bajo" ? "warning" : "danger"
                }
              >
                {status}
              </Badge>
            ),
          },
        ]}
        columns={4}
      />
    </DetailSection>
  );
}
