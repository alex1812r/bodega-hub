import type { PaymentRelatedDocument } from "../utils/resolvePaymentRelatedDocument";

export type PaymentDocumentBalance = PaymentRelatedDocument & {
  paidVes: number;
  pendingVes: number;
  totalVes: number;
};
