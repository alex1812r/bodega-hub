import type { PaymentMock } from "@/shared/mocks/erp-data";

import { formatPurchaseNumberDisplay } from "../payments-list/utils/paymentReference";

export type PaymentRelatedDocument = {
  href: string;
  label: string;
};

type SaleRef = { id: string; invoiceNumber: string };
type PurchaseRef = { id: string; purchaseNumber: string };

export function resolvePaymentRelatedDocument(
  payment: Pick<PaymentMock, "purchaseId" | "saleId">,
  sales: SaleRef[],
  purchases: PurchaseRef[],
): PaymentRelatedDocument | undefined {
  if (payment.saleId) {
    const sale = sales.find((item) => item.id === payment.saleId);

    if (sale) {
      return {
        href: `/sales/${sale.id}`,
        label: sale.invoiceNumber,
      };
    }
  }

  if (payment.purchaseId) {
    const purchase = purchases.find((item) => item.id === payment.purchaseId);

    if (purchase) {
      return {
        href: `/purchases/${purchase.id}`,
        label: formatPurchaseNumberDisplay(purchase.purchaseNumber),
      };
    }
  }

  return undefined;
}
