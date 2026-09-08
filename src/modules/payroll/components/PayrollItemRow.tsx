"use client";

import { Badge } from "@/shared/components/Badge";
import { ActionsMenu, type ActionMenuItem } from "@/shared/components/ActionsMenu";
import { formatRefUsd } from "@/shared/utils/currency";

import type { PayrollItem, PayrollPeriodStatus } from "../types";

import { payrollItemStatusLabels, payrollItemStatusVariants } from "./payrollLabels";

export type PayrollItemRowProps = {
  /** `false` para el rol que solo mira (nunca se pintan acciones de escritura). */
  canManage?: boolean;
  isBusy?: boolean;
  item: PayrollItem;
  onCancelPayment?: (item: PayrollItem) => void;
  onPay?: (item: PayrollItem) => void;
  onReceipt?: (item: PayrollItem) => void;
  onViewSales?: (item: PayrollItem) => void;
  periodStatus: PayrollPeriodStatus;
};

/** Fila de la tabla de ítems del detalle de quincena (un cajero). */
export function PayrollItemRow({
  canManage = true,
  isBusy = false,
  item,
  onCancelPayment,
  onPay,
  onReceipt,
  onViewSales,
  periodStatus,
}: PayrollItemRowProps) {
  const isPaid = item.status === "pagado";
  const canPay = canManage && !isPaid && periodStatus !== "borrador";
  const actions: ActionMenuItem[] = [];

  if (onViewSales) {
    actions.push({ label: "Ver ventas", onSelect: () => onViewSales(item) });
  }

  if (canPay && onPay) {
    actions.push({ disabled: isBusy, label: "Pagar", onSelect: () => onPay(item) });
  }

  if (canManage && isPaid && onCancelPayment) {
    actions.push({
      disabled: isBusy,
      label: "Anular pago",
      onSelect: () => onCancelPayment(item),
      variant: "danger",
    });
  }

  if (isPaid && onReceipt) {
    actions.push({ label: "Recibo PDF", onSelect: () => onReceipt(item) });
  }

  return (
    <tr className="border-t border-outline-variant align-middle">
      <th
        className="px-3 py-2 text-left text-sm font-medium text-foreground"
        scope="row"
      >
        {item.fullName}
      </th>
      <td className="px-3 py-2 text-right text-sm tabular-nums text-on-surface-variant">
        {item.salesCount}
      </td>
      <td className="hidden px-3 py-2 text-right text-sm tabular-nums text-on-surface-variant md:table-cell">
        {formatRefUsd(item.salesRef)}
      </td>
      <td className="hidden px-3 py-2 text-right text-sm tabular-nums text-on-surface-variant md:table-cell">
        {item.commissionPct.toFixed(2)} %
      </td>
      <td className="px-3 py-2 text-right text-sm tabular-nums text-on-surface-variant">
        {formatRefUsd(item.commissionRef)}
      </td>
      <td className="hidden px-3 py-2 text-right text-sm tabular-nums text-on-surface-variant lg:table-cell">
        {item.reversalRef === 0 ? "—" : formatRefUsd(item.reversalRef)}
      </td>
      <td className="px-3 py-2 text-right text-sm">
        <strong className="tabular-nums text-foreground">{formatRefUsd(item.totalRef)}</strong>
      </td>
      <td className="px-3 py-2">
        <Badge variant={payrollItemStatusVariants[item.status]}>
          {payrollItemStatusLabels[item.status]}
        </Badge>
      </td>
      <td className="px-3 py-2 text-right">
        {actions.length > 0 ? (
          <ActionsMenu
            actions={actions}
            label={`Acciones de ${item.fullName}`}
            variant="secondary"
          />
        ) : null}
      </td>
    </tr>
  );
}
