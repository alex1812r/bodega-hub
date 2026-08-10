import type { PaymentRelatedDocument } from "../utils/resolvePaymentRelatedDocument";

export type PaymentDocumentBalance = PaymentRelatedDocument & {
  paidRef?: number;
  paidVes: number;
  pendingRef?: number;
  pendingVes: number;
  totalRef?: number;
  totalVes: number;
};
