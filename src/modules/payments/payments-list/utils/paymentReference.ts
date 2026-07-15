import type { PaymentListItem } from "../../hooks/usePayments";
import { formatTruncatedCode } from "@/shared/utils/truncatedCode";

export function formatPurchaseNumberDisplay(purchaseNumber: string) {
  if (purchaseNumber.startsWith("#")) {
    return purchaseNumber;
  }

  const normalized = purchaseNumber.replace(/^C-?/i, "");
  return `#C-${normalized}`;
}

export { formatTruncatedCode };

export function getPaymentReference(payment: PaymentListItem) {
  const documentLabel = payment.relatedDocument?.label;
  const fullLabel =
    documentLabel ??
    payment.referenceCode?.trim() ??
    payment.saleId ??
    payment.purchaseId ??
    "";

  if (!fullLabel) {
    return {
      copyValue: "",
      displayValue: "—",
      fullValue: "—",
      href: undefined as string | undefined,
    };
  }

  const href =
    payment.relatedDocument?.href ??
    (payment.saleId ? `/sales/${payment.saleId}` : undefined) ??
    (payment.purchaseId ? `/purchases/${payment.purchaseId}` : undefined);

  const copyValue = payment.referenceCode?.trim() || fullLabel;

  return {
    copyValue,
    displayValue: formatTruncatedCode(fullLabel),
    fullValue: fullLabel,
    href,
  };
}
