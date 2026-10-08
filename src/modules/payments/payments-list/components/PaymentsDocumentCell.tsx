import Link from "next/link";

import { withReturnTo } from "@/shared/utils/returnTo";

import type { PaymentListItem } from "../../hooks/usePayments";
import { getPaymentDocument } from "../utils/paymentDocument";

type PaymentsDocumentCellProps = {
  /** URL exacta de la lista (`list.href`): viaja como `returnTo` al detalle. */
  listHref: string;
  payment: PaymentListItem;
};

/** Número de la venta o compra del pago, enlazado a su detalle. */
export function PaymentsDocumentCell({ listHref, payment }: PaymentsDocumentCellProps) {
  const document = getPaymentDocument(payment);

  if (!document) {
    return <span className="text-outline">—</span>;
  }

  return (
    <Link
      className="block min-w-0 truncate rounded font-mono text-[13px] leading-[18px] text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      href={withReturnTo(document.href, listHref)}
      title={document.label}
    >
      {document.label}
    </Link>
  );
}
