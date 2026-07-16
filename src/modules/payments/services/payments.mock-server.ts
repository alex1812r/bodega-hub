import { ApiError } from "@/lib/api/apiError";
import { assertMockStoreResource } from "@/lib/api/assertStoreResource";
import { paginateList } from "@/lib/api/pagination";
import {
  mockContacts,
  mockPayments,
  mockPurchases,
  mockSales,
  type PaymentMethod,
  type PaymentMock,
} from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import type { PaymentDocumentBalance } from "../payment-details/types";
import { formatPurchaseNumberDisplay } from "../payments-list/utils/paymentReference";
import { resolvePaymentRelatedDocument } from "../utils/resolvePaymentRelatedDocument";

export type PaymentInput = {
  amount: number;
  bankName?: string;
  currency?: "USD" | "VES";
  method: PaymentMethod;
  notes?: string;
  phone?: string;
  purchaseId?: string;
  referenceCode?: string;
  saleId?: string;
};

export type PaymentUpdateInput = {
  bankName?: string;
  notes?: string;
  phone?: string;
  referenceCode?: string;
};

export function listPayments(searchParams: URLSearchParams, storeId: string) {
  const contactId = searchParams.get("contactId");
  const direction = searchParams.get("direction");
  const purchaseId = searchParams.get("purchaseId");
  const saleId = searchParams.get("saleId");

  const items = mockPayments
    .filter((payment) => {
      return (
        (payment.storeId ?? DEFAULT_STORE_ID) === storeId &&
        (!direction || payment.direction === direction) &&
        (!saleId || payment.saleId === saleId) &&
        (!purchaseId || payment.purchaseId === purchaseId) &&
        (!contactId || payment.contactId === contactId)
      );
    })
    .map((payment) => ({
      ...payment,
      contact: mockContacts.find((contact) => contact.id === payment.contactId),
      relatedDocument: resolvePaymentRelatedDocument(payment, mockSales, mockPurchases),
    }));

  return paginateList(items, searchParams);
}

function resolveMockDocumentBalance(
  payment: PaymentMock,
): PaymentDocumentBalance | undefined {
  if (payment.saleId) {
    const sale = mockSales.find((candidate) => candidate.id === payment.saleId);

    if (!sale) {
      return undefined;
    }

    return {
      href: `/sales/${sale.id}`,
      label: sale.invoiceNumber,
      paidVes: sale.paidVes,
      pendingVes: Math.max(sale.totalVes - sale.paidVes, 0),
      totalVes: sale.totalVes,
    };
  }

  if (payment.purchaseId) {
    const purchase = mockPurchases.find((candidate) => candidate.id === payment.purchaseId);

    if (!purchase) {
      return undefined;
    }

    return {
      href: `/purchases/${purchase.id}`,
      label: formatPurchaseNumberDisplay(purchase.purchaseNumber),
      paidVes: purchase.paidVes,
      pendingVes: Math.max(purchase.totalVes - purchase.paidVes, 0),
      totalVes: purchase.totalVes,
    };
  }

  return undefined;
}

export function getPaymentById(id: string, storeId: string) {
  const payment = mockPayments.find((item) => item.id === id);
  assertMockStoreResource(payment, storeId, "Pago no encontrado.");

  const documentBalance = resolveMockDocumentBalance(payment);

  return {
    ...payment,
    contact: mockContacts.find((contact) => contact.id === payment.contactId),
    documentBalance,
    pendingBalanceVes: documentBalance?.pendingVes,
    relatedDocument: resolvePaymentRelatedDocument(payment, mockSales, mockPurchases),
  };
}

export function updatePayment(id: string, input: PaymentUpdateInput, storeId: string) {
  const payment = mockPayments.find((item) => item.id === id);
  assertMockStoreResource(payment, storeId, "Pago no encontrado.");

  if (input.bankName !== undefined) {
    payment.bankName = input.bankName;
  }

  if (input.notes !== undefined) {
    payment.notes = input.notes;
  }

  if (input.phone !== undefined) {
    payment.phone = input.phone;
  }

  if (input.referenceCode !== undefined) {
    payment.referenceCode = input.referenceCode;
  }

  return getPaymentById(id, storeId);
}

export function createPayment(input: PaymentInput, storeId: string) {
  const sale = input.saleId
    ? mockSales.find((candidate) => candidate.id === input.saleId)
    : undefined;
  const purchase = input.purchaseId
    ? mockPurchases.find((candidate) => candidate.id === input.purchaseId)
    : undefined;

  if (sale) {
    assertMockStoreResource(sale, storeId, "Venta no encontrada.");
  }
  if (purchase) {
    assertMockStoreResource(purchase, storeId, "Compra no encontrada.");
  }

  const direction = sale ? "entrada" : "salida";
  const refRateVes = sale?.refRateVes ?? purchase?.refRateVes ?? 510;
  const amountVes =
    input.method === "efectivo_usd" || input.currency === "USD"
      ? Math.round(input.amount * refRateVes * 100) / 100
      : input.amount;
  const amountRef =
    input.method === "efectivo_usd" || input.currency === "USD"
      ? input.amount
      : Math.round((input.amount / refRateVes) * 100) / 100;
  const totalVes = sale?.totalVes ?? purchase?.totalVes ?? 0;
  const paidVes = sale?.paidVes ?? purchase?.paidVes ?? 0;

  return {
    amount: input.amount,
    amountRef,
    amountVes,
    bankName: input.bankName,
    contactId: sale?.customerId ?? purchase?.supplierId ?? "cont-customer",
    createdAt: new Date().toISOString(),
    currency: input.currency,
    direction,
    id: `pay-mock-${Date.now()}`,
    method: input.method,
    purchaseId: input.purchaseId,
    referenceCode: input.referenceCode,
    refRateVes,
    saleId: input.saleId,
    status: "activo",
    storeId,
    pendingBalanceVes: Math.max(totalVes - paidVes - amountVes, 0),
  } satisfies PaymentMock;
}

export function cancelPayment(id: string, storeId: string) {
  const payment = mockPayments.find((item) => item.id === id);
  assertMockStoreResource(payment, storeId, "Pago no encontrado.");

  if (payment.status === "anulado") {
    throw new ApiError(400, "BAD_REQUEST", "El pago ya fue anulado.");
  }

  if (payment.saleId) {
    const sale = mockSales.find((candidate) => candidate.id === payment.saleId);
    assertMockStoreResource(sale, storeId, "Venta no encontrada.");

    if (sale.status === "cancelada" || sale.status === "devuelta") {
      throw new ApiError(
        400,
        "BAD_REQUEST",
        "No se puede anular un pago de una venta cancelada o devuelta.",
      );
    }

    if (sale.paidVes < payment.amountVes) {
      throw new ApiError(400, "BAD_REQUEST", "El monto del pago excede lo registrado en la venta.");
    }

    sale.paidVes -= payment.amountVes;

    if (sale.status !== "borrador") {
      sale.status = sale.paidVes >= sale.totalVes ? "pagada" : "pendiente_pago";
    }
  }

  if (payment.purchaseId) {
    const purchase = mockPurchases.find((candidate) => candidate.id === payment.purchaseId);
    assertMockStoreResource(purchase, storeId, "Compra no encontrada.");

    if (purchase.status === "cancelado" || purchase.status === "devuelto") {
      throw new ApiError(
        400,
        "BAD_REQUEST",
        "No se puede anular un pago de una compra cancelada o devuelta.",
      );
    }

    if (purchase.paidVes < payment.amountVes) {
      throw new ApiError(
        400,
        "BAD_REQUEST",
        "El monto del pago excede lo registrado en la compra.",
      );
    }

    purchase.paidVes -= payment.amountVes;
  }

  payment.status = "anulado";
  payment.cancelledAt = new Date().toISOString();

  return getPaymentById(id, storeId);
}
