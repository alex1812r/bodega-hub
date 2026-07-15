"use client";

import { PageBackButton } from "@/shared/components/PageBackButton";
import type { SaleStatus } from "@/shared/mocks/erp-data";
import { formatDateTimeShort } from "@/shared/utils/date";

import { formatInvoiceHeading } from "../utils/saleDetailLabels";
import { SaleDetailActionsMenu } from "./SaleDetailActionsMenu";
import { SaleDetailStatusBadge } from "./SaleDetailStatusBadge";

type SaleDetailHeaderCardProps = {
  createdAt: string;
  invoiceNumber: string;
  isCancelling?: boolean;
  isExportingPdf?: boolean;
  isReturning?: boolean;
  onCancel?: () => void | Promise<void>;
  onDownloadPdf?: () => void | Promise<void>;
  onPrint?: () => void;
  onReturn?: () => void | Promise<void>;
  saleId: string;
  status: SaleStatus;
};

export function SaleDetailHeaderCard({
  createdAt,
  invoiceNumber,
  isCancelling = false,
  isExportingPdf = false,
  isReturning = false,
  onCancel,
  onDownloadPdf,
  onPrint,
  onReturn,
  saleId,
  status,
}: SaleDetailHeaderCardProps) {
  return (
    <header className="flex flex-col gap-4 rounded border border-border bg-surface-container-lowest p-4 shadow-sm md:flex-row md:items-center md:justify-between dark:border-slate-800">
      <div>
        <p className="text-sm font-medium text-primary">Ventas</p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-foreground md:text-2xl">
            Factura {formatInvoiceHeading(invoiceNumber)}
          </h1>
          <SaleDetailStatusBadge status={status} />
        </div>
        <p className="mt-1 text-sm text-on-surface-variant">
          Creada el {formatDateTimeShort(createdAt)}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <PageBackButton href="/sales" size="sm" />
        <SaleDetailActionsMenu
          invoiceNumber={invoiceNumber}
          isCancelling={isCancelling}
          isExportingPdf={isExportingPdf}
          isReturning={isReturning}
          onCancel={() => void onCancel?.()}
          onDownloadPdf={() => void onDownloadPdf?.()}
          onPrint={() => onPrint?.()}
          onReturn={() => void onReturn?.()}
          saleId={saleId}
          status={status}
        />
      </div>
    </header>
  );
}
