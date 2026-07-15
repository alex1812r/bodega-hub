"use client";



import { PurchasesStatusBadge } from "@/modules/purchases/purchases-list/components/PurchasesStatusBadge";

import type { PurchaseStatus } from "@/shared/mocks/erp-data";



import { formatPurchaseHeading } from "../utils/purchaseDetailLabels";

import { PurchaseDetailActionsMenu } from "./PurchaseDetailActionsMenu";



type PurchaseDetailHeaderCardProps = {

  isCancelling?: boolean;

  isExportingPdf?: boolean;

  isReceiving?: boolean;

  isReturning?: boolean;

  onCancel: () => void | Promise<void>;

  onExportPdf: () => void | Promise<void>;

  onReceive: () => void | Promise<void>;

  onReturn: () => void | Promise<void>;

  purchaseId: string;

  purchaseNumber: string;

  status: PurchaseStatus;

};



export function PurchaseDetailHeaderCard({

  isCancelling = false,

  isExportingPdf = false,

  isReceiving = false,

  isReturning = false,

  onCancel,

  onExportPdf,

  onReceive,

  onReturn,

  purchaseId,

  purchaseNumber,

  status,

}: PurchaseDetailHeaderCardProps) {

  return (

    <header className="flex flex-col gap-4 rounded-xl border border-border bg-surface-container-lowest p-6 shadow-sm md:flex-row md:items-center md:justify-between dark:border-slate-800">

      <div>

        <div className="flex flex-wrap items-center gap-3">

          <h2 className="text-xl font-semibold text-foreground md:text-2xl">

            {formatPurchaseHeading(purchaseNumber)}

          </h2>

          <PurchasesStatusBadge status={status} />

        </div>

        <p className="mt-1 text-sm text-on-surface-variant">

          Detalles de la transacción y recepción de mercancía.

        </p>

      </div>



      <PurchaseDetailActionsMenu

        isCancelling={isCancelling}

        isExportingPdf={isExportingPdf}

        isReceiving={isReceiving}

        isReturning={isReturning}

        onCancel={onCancel}

        onExportPdf={onExportPdf}

        onReceive={onReceive}

        onReturn={onReturn}

        purchaseId={purchaseId}

        purchaseNumber={purchaseNumber}

        status={status}

      />

    </header>

  );

}

