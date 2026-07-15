"use client";

import { type ReactNode } from "react";

import { Button } from "@/shared/components/Button";
import { CopyableCodeCell } from "@/shared/components/CopyableCodeCell";
import { Modal } from "@/shared/components/Modal";
import { cn } from "@/shared/utils/cn";
import { formatDateTimeShort } from "@/shared/utils/date";
import { formatTruncatedCode } from "@/shared/utils/truncatedCode";

import type { InventoryMovement } from "../../hooks/useInventory";
import { InventoryMovementQuantityCell } from "./InventoryMovementQuantityCell";
import { InventoryMovementReferenceCell } from "./InventoryMovementReferenceCell";
import { InventoryMovementTypeBadge } from "./InventoryMovementTypeBadge";

type InventoryMovementDetailModalProps = {
  movement: InventoryMovement | null;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

function DetailField({
  className,
  label,
  value,
  valueClassName,
}: {
  className?: string;
  label: string;
  value: ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
        {label}
      </span>
      <div className={cn("text-sm font-medium text-foreground", valueClassName)}>{value}</div>
    </div>
  );
}

export function InventoryMovementDetailModal({
  movement,
  onOpenChange,
  open,
}: InventoryMovementDetailModalProps) {
  const stockBefore =
    movement != null ? movement.stockAfter - movement.quantityDelta : undefined;

  return (
    <Modal
      contentClassName="sm:max-w-2xl"
      description="Consulta el impacto del movimiento sobre el stock y su trazabilidad."
      footer={({ close }) => (
        <Button onClick={close} variant="outline">
          Cerrar
        </Button>
      )}
      onOpenChange={onOpenChange}
      open={open}
      title="Detalle de movimiento"
    >
      {movement ? (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-outline-variant/60 bg-surface-container-low px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <InventoryMovementTypeBadge type={movement.type} />
              <span className="text-sm text-on-surface-variant">
                {formatDateTimeShort(movement.createdAt)}
              </span>
            </div>
            <CopyableCodeCell
              copyValue={movement.id}
              displayValue={formatTruncatedCode(movement.id)}
              fullValue={movement.id}
              maxWidthClass="w-auto max-w-[12rem]"
            />
          </div>

          <div className="grid grid-cols-1 gap-x-8 gap-y-5 md:grid-cols-2">
            <DetailField
              label="Producto"
              value={movement.product?.name ?? movement.productId}
            />
            <DetailField
              label="SKU"
              value={
                <span className="font-mono text-[13px]">
                  {movement.product?.sku ?? "—"}
                </span>
              }
            />
            <DetailField
              label="Cantidad"
              value={<InventoryMovementQuantityCell quantity={movement.quantityDelta} />}
              valueClassName="text-base"
            />
            <DetailField
              label="Stock antes"
              value={
                stockBefore != null ? (
                  <span className="tabular-nums">{stockBefore}</span>
                ) : (
                  "—"
                )
              }
            />
            <DetailField
              label="Stock final"
              value={
                <span className="text-base font-bold tabular-nums">{movement.stockAfter}</span>
              }
            />
            <DetailField
              label="Referencia"
              value={
                movement.saleId || movement.purchaseId ? (
                  <InventoryMovementReferenceCell
                    purchaseId={movement.purchaseId}
                    saleId={movement.saleId}
                  />
                ) : (
                  <span className="text-on-surface-variant">Manual</span>
                )
              }
            />
          </div>

          <div className="flex flex-col gap-1 border-t border-outline-variant/50 pt-4">
            <span className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              Motivo
            </span>
            <p className="rounded-md border border-outline-variant/50 bg-surface-bright p-3 text-sm text-foreground">
              {movement.reason?.trim() || "Sin motivo registrado."}
            </p>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
