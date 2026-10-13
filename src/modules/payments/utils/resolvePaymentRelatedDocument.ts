import type { PaymentMock } from "@/shared/mocks/erp-data";

import { formatPurchaseNumberDisplay } from "../payments-list/utils/paymentReference";

export type PaymentRelatedDocument = {
  href: string;
  label: string;
};

/** Columnas del documento que acompañan a un pago leído de la base. */
export const PAYMENT_RELATED_DOCUMENT_SELECT =
  "sale:sales(id, invoice_number), purchase:purchases(id, purchase_number)";

export type PaymentRelatedDocumentRow = {
  purchase?: { id: string; purchase_number: string } | null;
  sale?: { id: string; invoice_number: string } | null;
};

/** Número y enlace de la venta o compra de un pago leído con `PAYMENT_RELATED_DOCUMENT_SELECT`. */
export function mapPaymentRelatedDocument(
  row: PaymentRelatedDocumentRow,
): PaymentRelatedDocument | undefined {
  if (row.sale?.id && row.sale.invoice_number) {
    return {
      href: `/sales/${row.sale.id}`,
      label: row.sale.invoice_number,
    };
  }

  if (row.purchase?.id && row.purchase.purchase_number) {
    return {
      href: `/purchases/${row.purchase.id}`,
      label: formatPurchaseNumberDisplay(row.purchase.purchase_number),
    };
  }

  return undefined;
}

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
