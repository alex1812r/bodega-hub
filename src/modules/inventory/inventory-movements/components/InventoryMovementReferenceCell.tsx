"use client";

import { CopyableCodeCell } from "@/shared/components/CopyableCodeCell";
import { formatTruncatedCode } from "@/shared/utils/truncatedCode";

type InventoryMovementReferenceCellProps = {
  purchaseId?: string;
  saleId?: string;
};

export function InventoryMovementReferenceCell({
  purchaseId,
  saleId,
}: InventoryMovementReferenceCellProps) {
  if (saleId) {
    return (
      <CopyableCodeCell
        copyValue={saleId}
        displayValue={formatTruncatedCode(saleId)}
        fullValue={saleId}
        href={`/sales/${saleId}`}
        maxWidthClass="w-full max-w-none"
      />
    );
  }

  if (purchaseId) {
    return (
      <CopyableCodeCell
        copyValue={purchaseId}
        displayValue={formatTruncatedCode(purchaseId)}
        fullValue={purchaseId}
        href={`/purchases/${purchaseId}`}
        maxWidthClass="w-full max-w-none"
      />
    );
  }

  return <span className="text-on-surface-variant">—</span>;
}
