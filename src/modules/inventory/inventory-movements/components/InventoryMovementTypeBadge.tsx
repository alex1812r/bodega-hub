"use client";

import { Badge } from "@/shared/components/Badge";
import type { StockMovementType } from "@/shared/mocks/erp-data";

import {
  getMovementTypeLabel,
  movementTypeBadgeVariant,
} from "../utils/movementTypeLabels";

type InventoryMovementTypeBadgeProps = {
  type: StockMovementType;
};

export function InventoryMovementTypeBadge({ type }: InventoryMovementTypeBadgeProps) {
  return (
    <Badge variant={movementTypeBadgeVariant[type]}>
      {getMovementTypeLabel(type)}
    </Badge>
  );
}
