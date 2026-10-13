import { ApiError } from "@/lib/api/apiError";
import { mockEntityStoreId } from "@/lib/api/assertStoreResource";
import { findMockPurchase } from "@/modules/purchases/services/purchases.mock-server";
import { assertCanAccessPayment } from "@/shared/auth/paymentAccess";
import type { UserRole } from "@/shared/auth/permissions";
import { mockContacts, mockPayments, mockSales, type PaymentMock } from "@/shared/mocks/erp-data";

import {
  computePaymentImpact,
  type PaymentImpactAction,
  type PaymentImpactInputs,
} from "./paymentImpact";

const DEMO_LEDGER_REASON =
  "El modo demo no registra asientos de caja ni de baúl por pago: no se puede anticipar de dónde sale ni a dónde vuelve el dinero.";
const CANCEL_ROLES: readonly UserRole[] = ["admin", "contador"];

function documentOf(payment: PaymentMock, storeId: string): PaymentImpactInputs["document"] {
  const contactName = mockContacts.find((contact) => contact.id === payment.contactId)?.name ?? null;

  if (payment.saleId) {
    const sale = mockSales.find((candidate) => candidate.id === payment.saleId);

    if (!sale || mockEntityStoreId(sale) !== storeId) {
      throw new ApiError(404, "NOT_FOUND", "Venta no encontrada.");
    }

    return {
      contactName,
      id: sale.id,
      kind: "sale",
      number: sale.invoiceNumber,
      paidVes: sale.paidVes,
      status: sale.status,
      totalVes: sale.totalVes,
    };
  }

  const purchase = payment.purchaseId ? findMockPurchase(payment.purchaseId) : undefined;

  if (!purchase || mockEntityStoreId(purchase) !== storeId) {
    throw new ApiError(404, "NOT_FOUND", "Compra no encontrada.");
  }

  return {
    contactName,
    id: purchase.id,
    kind: "purchase",
    number: purchase.purchaseNumber,
    paidRef: purchase.paidRef ?? 0,
    paidVes: purchase.paidVes,
    status: purchase.status,
    totalRef: purchase.totalRef,
    totalVes: purchase.totalVes,
  };
}

/** Mismos datos que el cargador real, leídos del mock. Pago ajeno o inexistente → 404. */
export function loadPaymentImpactInputs(
  paymentId: string,
  action: PaymentImpactAction,
  storeId: string,
  role: UserRole,
): PaymentImpactInputs {
  const payment = mockPayments.find((item) => item.id === paymentId);

  if (!payment || mockEntityStoreId(payment) !== storeId) {
    throw new ApiError(404, "NOT_FOUND", "Pago no encontrado.");
  }

  assertCanAccessPayment(role, payment);

  return {
    action,
    canCancelPayments: CANCEL_ROLES.includes(role),
    document: documentOf(payment, storeId),
    ledger: { kind: "unavailable", reason: DEMO_LEDGER_REASON },
    payment: {
      amount: payment.amount,
      amountRef: payment.amountRef,
      amountVes: payment.amountVes,
      // El mock de pagos no guarda el vuelto.
      changeMethod: null,
      changeRef: 0,
      changeVes: 0,
      currency: payment.method === "efectivo_usd" || payment.currency === "USD" ? "USD" : "VES",
      id: payment.id,
      method: payment.method,
      status: payment.status ?? "activo",
    },
  };
}

export function getPaymentImpact(
  id: string,
  action: PaymentImpactAction,
  storeId: string,
  role: UserRole,
) {
  return computePaymentImpact(loadPaymentImpactInputs(id, action, storeId, role));
}
