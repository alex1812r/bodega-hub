"use client";

import { Badge } from "@/shared/components/Badge";
import { EmptyState } from "@/shared/components/EmptyState";
import { Modal } from "@/shared/components/Modal";
import { formatRefUsd } from "@/shared/utils/currency";
import { formatDateTimeShort } from "@/shared/utils/date";

import {
  payrollCommissionKindLabels,
  payrollCommissionKindVariants,
} from "./payrollLabels";
import type { PayrollCommissionSale } from "../types";

type PayrollSalesModalProps = {
  cashierName: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  sales: PayrollCommissionSale[];
};

/** Detalle auditable: cada venta que comisiono (o descomisiono) al cajero. */
export function PayrollSalesModal({
  cashierName,
  onOpenChange,
  open,
  sales,
}: PayrollSalesModalProps) {
  return (
    <Modal
      description={`Ventas que entraron en la comision de ${cashierName}.`}
      onOpenChange={onOpenChange}
      open={open}
      title="Ventas comisionadas"
    >
      {sales.length === 0 ? (
        <EmptyState
          className="py-8"
          description="Esta quincena no le sumo ninguna venta a este cajero."
          title="Sin ventas comisionadas"
        />
      ) : (
        <ul className="divide-y divide-outline-variant">
          {sales.map((sale) => (
            <li className="flex flex-wrap items-center justify-between gap-2 py-3" key={sale.id}>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {sale.invoiceNumber ?? sale.saleId}
                </p>
                <p className="text-xs text-on-surface-variant">
                  {formatDateTimeShort(sale.saleCreatedAt)} · {formatRefUsd(sale.saleTotalRef)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {sale.kind === "normal" ? null : (
                  <Badge variant={payrollCommissionKindVariants[sale.kind]}>
                    {payrollCommissionKindLabels[sale.kind]}
                  </Badge>
                )}
                <strong className="tabular-nums text-sm text-foreground">
                  {formatRefUsd(sale.commissionRef)}
                </strong>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
