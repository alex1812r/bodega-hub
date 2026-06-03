import { ApiError } from "@/lib/api/apiError";
import { paginateList } from "@/lib/api/pagination";
import {
  mockContacts,
  mockPayments,
  mockPurchases,
  mockSales,
  type PaymentMethod,
  type PaymentMock,
} from "@/shared/mocks/erp-data";

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

export function listPayments(searchParams: URLSearchParams) {
  const contactId = searchParams.get("contactId");
  const direction = searchParams.get("direction");
  const purchaseId = searchParams.get("purchaseId");
  const saleId = searchParams.get("saleId");

  const items = mockPayments
    .filter((payment) => {
      return (
        (!direction || payment.direction === direction) &&
        (!saleId || payment.saleId === saleId) &&
        (!purchaseId || payment.purchaseId === purchaseId) &&
        (!contactId || payment.contactId === contactId)
      );
    })
    .map((payment) => ({
      ...payment,
      contact: mockContacts.find((contact) => contact.id === payment.contactId),
    }));

  return paginateList(items, searchParams);
}

export function getPaymentById(id: string) {
  const payment = mockPayments.find((item) => item.id === id);

  if (!payment) {
    throw new ApiError(404, "NOT_FOUND", "Pago no encontrado.");
  }

  const sale = payment.saleId
    ? mockSales.find((candidate) => candidate.id === payment.saleId)
    : undefined;
  const purchase = payment.purchaseId
    ? mockPurchases.find((candidate) => candidate.id === payment.purchaseId)
    : undefined;
  const totalVes = sale?.totalVes ?? purchase?.totalVes ?? 0;
  const paidVes = sale?.paidVes ?? purchase?.paidVes ?? 0;

  return {
    ...payment,
    contact: mockContacts.find((contact) => contact.id === payment.contactId),
    pendingBalanceVes: Math.max(totalVes - paidVes, 0),
  };
}

export function updatePayment(id: string, input: PaymentUpdateInput) {
  const payment = mockPayments.find((item) => item.id === id);

  if (!payment) {
    throw new ApiError(404, "NOT_FOUND", "Pago no encontrado.");
  }

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

  return getPaymentById(id);
}

export function createPayment(input: PaymentInput) {
  const sale = input.saleId
    ? mockSales.find((candidate) => candidate.id === input.saleId)
    : undefined;
  const purchase = input.purchaseId
    ? mockPurchases.find((candidate) => candidate.id === input.purchaseId)
    : undefined;
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
    pendingBalanceVes: Math.max(totalVes - paidVes - amountVes, 0),
  } satisfies PaymentMock;
}
