"use client";

import { HandCoins, Printer } from "lucide-react";

import {
  PrimaryStateAction,
  type PrimaryStateActionConfig,
  type PrimaryStateNotice,
} from "@/shared/components/PrimaryStateAction";
import type { SaleStatus } from "@/shared/mocks/erp-data";
import { formatRefUsd, formatVesBs, roundMoney } from "@/shared/utils/currency";
import { formatDateTimeShort } from "@/shared/utils/date";

import { formatInvoiceHeading } from "../utils/saleDetailLabels";
import { SaleDetailActionsMenu } from "./SaleDetailActionsMenu";
import { SaleDetailBackButton } from "./SaleDetailBackButton";
import { SaleDetailStatusBadge } from "./SaleDetailStatusBadge";

type SaleDetailHeaderProps = {
  /** La venta admite cobros y el usuario puede registrarlos (lo decide la página). */
  canCollectBalance: boolean;
  createdAt: string;
  invoiceNumber: string;
  isCancelling?: boolean;
  isExportingPdf?: boolean;
  isReturning?: boolean;
  onCancel: () => void | Promise<void>;
  /** Abre el modal de cobro. */
  onCollect: () => void;
  onDownloadPdf: () => void | Promise<void>;
  /** Imprime el recibo: la misma acción final que "Imprimir factura" del menú. */
  onPrint: () => void;
  onReturn: () => void | Promise<void>;
  paidVes: number;
  pendingVes: number;
  status: SaleStatus;
  totalRef: number;
  totalVes: number;
};

const closedStatusNotices: Partial<Record<SaleStatus, string>> = {
  borrador: "Venta en borrador: todavía no admite cobros.",
  cancelada: "Venta anulada: no admite cobros.",
  devuelta: "Venta devuelta: no admite cobros.",
};

/**
 * Cabecera del detalle de venta: título, "Volver", menú "…" y el resumen con la
 * única acción primaria que corresponde al estado real de la venta.
 *
 * - con saldo y permiso de cobro → "Cobrar saldo";
 * - pagada, o con saldo pero sin permiso → "Recibo";
 * - anulada / devuelta → "Recibo" secundario y aviso del estado (nunca cobrar);
 * - borrador → sin acción primaria, solo el aviso.
 */
export function SaleDetailHeader({
  canCollectBalance,
  createdAt,
  invoiceNumber,
  isCancelling = false,
  isExportingPdf = false,
  isReturning = false,
  onCancel,
  onCollect,
  onDownloadPdf,
  onPrint,
  onReturn,
  paidVes,
  pendingVes,
  status,
  totalRef,
  totalVes,
}: SaleDetailHeaderProps) {
  const hasBalance = roundMoney(pendingVes) > 0;
  // Mientras se anula o se devuelve, el estado en pantalla está por cambiar.
  const isPending = isCancelling || isReturning;
  const closedNotice = closedStatusNotices[status];

  let primaryAction: PrimaryStateActionConfig | undefined;
  let notice: PrimaryStateNotice | undefined;

  if (canCollectBalance) {
    primaryAction = {
      icon: <HandCoins aria-hidden="true" className="h-4 w-4" />,
      isPending,
      label: "Cobrar saldo",
      onClick: onCollect,
    };
  } else if (status !== "borrador") {
    primaryAction = {
      icon: <Printer aria-hidden="true" className="h-4 w-4" />,
      isPending,
      label: "Recibo",
      onClick: onPrint,
      variant: closedNotice ? "outline" : "primary",
    };
  }

  if (closedNotice) {
    notice = { text: closedNotice, tone: "info" };
  } else if (hasBalance && !canCollectBalance) {
    notice = {
      text: "Saldo pendiente. No tienes permiso para registrar cobros.",
      tone: "warning",
    };
  }

  return (
    <header className="space-y-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-primary">Ventas</p>
          <h1 className="mt-1 text-xl font-semibold text-foreground [overflow-wrap:anywhere] md:text-2xl">
            Factura {formatInvoiceHeading(invoiceNumber)}
          </h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            Creada el {formatDateTimeShort(createdAt)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SaleDetailBackButton />
          <SaleDetailActionsMenu
            invoiceNumber={invoiceNumber}
            isCancelling={isCancelling}
            isExportingPdf={isExportingPdf}
            isReturning={isReturning}
            onCancel={onCancel}
            onDownloadPdf={onDownloadPdf}
            onPrint={onPrint}
            onReturn={onReturn}
            status={status}
          />
        </div>
      </div>

      <PrimaryStateAction
        ariaLabel="Resumen de la venta"
        figures={[
          { hint: formatRefUsd(totalRef), label: "Total", value: formatVesBs(totalVes) },
          { label: "Pagado", tone: "success", value: formatVesBs(paidVes) },
          {
            label: "Saldo",
            tone: hasBalance ? "danger" : "default",
            value: formatVesBs(pendingVes),
          },
        ]}
        notice={notice}
        primaryAction={primaryAction}
        status={<SaleDetailStatusBadge status={status} />}
      />
    </header>
  );
}
