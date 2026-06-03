"use client";

import { Badge } from "@/shared/components/Badge";
import { Button } from "@/shared/components/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/Card";
import { InfoGrid } from "@/shared/components/InfoGrid";
import { formatDate } from "@/shared/utils/date";

import type { InventoryMovement } from "../../hooks/useInventory";

type InventoryMovementDetailModalProps = {
  movement: InventoryMovement | null;
  onClose: () => void;
};

export function InventoryMovementDetailModal({
  movement,
  onClose,
}: InventoryMovementDetailModalProps) {
  if (!movement) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Detalle de movimiento</CardTitle>
          <CardDescription>{movement.id}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <InfoGrid
            items={[
              { label: "Producto", value: movement.product?.name ?? movement.productId },
              { label: "Fecha", value: formatDate(movement.createdAt) },
              {
                label: "Tipo",
                value: <Badge variant="info">{movement.type}</Badge>,
              },
              { label: "Cantidad", value: String(movement.quantityDelta) },
              { label: "Stock final", value: String(movement.stockAfter ?? "—") },
              { label: "Motivo", value: movement.reason ?? "Sin motivo" },
            ]}
          />
          <div className="flex justify-end">
            <Button onClick={onClose} variant="outline">
              Cerrar
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
