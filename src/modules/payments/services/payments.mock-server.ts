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
import { mockState } from "@/shared/mocks/mockStore";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";
import { isUtcTimestampInCaracasDateRange } from "@/shared/utils/caracasBusinessDay";

import type { PaymentDocumentBalance } from "../payment-details/types";
import { formatPurchaseNumberDisplay } from "../payments-list/utils/paymentReference";
import { resolvePaymentRelatedDocument } from "../utils/resolvePaymentRelatedDocument";

/** Desglose de billetes por moneda: `{"USD":{"1":3}}`. */
export type PaymentDenominations = Partial<Record<"USD" | "VES", Record<string, number>>>;

/** Vuelto entregado por el excedente de un cobro (spec cobro-pos-billetes §2). */
export type PaymentChangeInput = {
  /** Monto en la moneda de `method`. */
  amount: number;
  bankName?: string;
  method?: PaymentMethod;
  phone?: string;
  referenceCode?: string;
};

export type PaymentInput = {
  amount: number;
  bankName?: string;
  change?: PaymentChangeInput | null;
  changeDenominations?: PaymentDenominations | null;
  /** Clave de idempotencia del intento (P4-3). */
  clientRequestId?: string;
  currency?: "USD" | "VES";
  method: PaymentMethod;
  notes?: string;
  phone?: string;
  purchaseId?: string;
  receivedDenominations?: PaymentDenominations | null;
  referenceCode?: string;
  saleId?: string;
};

export type PaymentUpdateInput = {
  bankName?: string;
  notes?: string;
  phone?: string;
  referenceCode?: string;
};

export type PaymentAccessOptions = {
  /** Cuando true, solo pagos de venta (sin purchaseId / sin salida). */
  salePaymentsOnly?: boolean;
};

function matchesSalePaymentsOnly(
  payment: PaymentMock,
  salePaymentsOnly: boolean | undefined,
) {
  if (!salePaymentsOnly) {
    return true;
  }

  return !payment.purchaseId && payment.direction !== "salida";
}

export function listPayments(
  searchParams: URLSearchParams,
  storeId: string,
  options: PaymentAccessOptions = {},
) {
  const contactId = searchParams.get("contactId");
  const direction = searchParams.get("direction");
  const from = searchParams.get("from");
  const method = searchParams.get("method");
  const purchaseId = searchParams.get("purchaseId");
  const saleId = searchParams.get("saleId");
  const to = searchParams.get("to");

  const items = mockPayments
    .filter((payment) => {
      return (
        (payment.storeId ?? DEFAULT_STORE_ID) === storeId &&
        matchesSalePaymentsOnly(payment, options.salePaymentsOnly) &&
        (!direction || payment.direction === direction) &&
        (!saleId || payment.saleId === saleId) &&
        (!purchaseId || payment.purchaseId === purchaseId) &&
        (!contactId || payment.contactId === contactId) &&
        (!method || payment.method === method) &&
        // Dias operativos Caracas, ambos inclusive.
        isUtcTimestampInCaracasDateRange(payment.createdAt, from, to)
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
      paidRef: purchase.paidRef ?? 0,
      paidVes: purchase.paidVes,
      pendingRef: Math.max(
        Math.round((purchase.totalRef - (purchase.paidRef ?? 0)) * 100) / 100,
        0,
      ),
      pendingVes: Math.max(purchase.totalVes - purchase.paidVes, 0),
      totalRef: purchase.totalRef,
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

type CreatedPaymentMock = ReturnType<typeof registerMockPayment>;

/**
 * Pagos ya registrados por clave de idempotencia (`storeId:clientRequestId`), como
 * hace `register_payment` en la base: la misma clave con el mismo contenido
 * devuelve el pago original; con otro contenido se rechaza.
 */
function paymentsByClientRequest() {
  return mockState(
    "payments:byClientRequest",
    () => new Map<string, { content: string; payment: CreatedPaymentMock }>(),
  );
}

/** Contenido del envio sin la clave, con las propiedades en orden estable. */
function paymentRequestContent(input: PaymentInput) {
  const sortKeys = (_key: string, value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
        )
      : value;

  return JSON.stringify({ ...input, clientRequestId: undefined }, sortKeys);
}

export function createPayment(input: PaymentInput, storeId: string) {
  const requestKey = input.clientRequestId ? `${storeId}:${input.clientRequestId}` : null;
  const previous = requestKey ? paymentsByClientRequest().get(requestKey) : undefined;

  if (previous) {
    const stored = mockPayments.find((item) => item.id === previous.payment.id);

    // Como `payment_idempotent_replay`: otro contenido o un pago ya anulado.
    if (previous.content !== paymentRequestContent(input) || stored?.status === "anulado") {
      throw new ApiError(
        409,
        "CONFLICT",
        "La clave de idempotencia ya se usó en otro pago. Revisa el pago registrado antes de reintentar.",
      );
    }

    return previous.payment;
  }

  const payment = registerMockPayment(input, storeId);

  if (requestKey) {
    paymentsByClientRequest().set(requestKey, {
      content: paymentRequestContent(input),
      payment,
    });
  }

  return payment;
}

/** Secuencia del id: dos pagos en el mismo milisegundo no comparten id. */
function nextPaymentSequence() {
  const sequence = mockState("payments:idSequence", () => ({ last: 0 }));

  sequence.last += 1;

  return sequence.last;
}

function registerMockPayment(input: PaymentInput, storeId: string) {
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

  if (sale) {
    sale.paidVes = Math.round((sale.paidVes + amountVes) * 100) / 100;

    // Regla de `register_payment`, que solo cobra ventas pagadas o pendientes.
    if (sale.status === "pagada" || sale.status === "pendiente_pago") {
      sale.status = sale.paidVes >= sale.totalVes ? "pagada" : "pendiente_pago";
    }
  }

  if (purchase) {
    purchase.paidVes = Math.round((purchase.paidVes + amountVes) * 100) / 100;
    purchase.paidRef = Math.round(((purchase.paidRef ?? 0) + amountRef) * 100) / 100;
  }

  const pendingBalanceVes = purchase
    ? Math.max(
        Math.round(
          ((purchase.totalRef - (purchase.paidRef ?? 0)) * refRateVes) * 100,
        ) / 100,
        0,
      )
    : Math.max(totalVes - paidVes - amountVes, 0);

  const payment = {
    amount: input.amount,
    amountRef,
    amountVes,
    bankName: input.bankName,
    contactId: sale?.customerId ?? purchase?.supplierId ?? "cont-customer",
    createdAt: new Date().toISOString(),
    currency: input.currency,
    direction,
    id: `pay-mock-${Date.now()}-${nextPaymentSequence()}`,
    method: input.method,
    notes: input.notes,
    phone: input.phone,
    purchaseId: input.purchaseId,
    referenceCode: input.referenceCode,
    refRateVes,
    saleId: input.saleId,
    status: "activo",
    storeId,
  } satisfies PaymentMock;

  // El pago queda guardado, como la fila de `payments`: de aqui leen la lista, el
  // detalle del documento y la anulacion. Sin documento en la semilla no hay saldo
  // que abonar ni fila que colgarle. El saldo va solo en la respuesta: en la fila
  // quedaria viejo con el siguiente pago.
  if (sale || purchase) {
    mockPayments.push(payment);
  }

  return { ...payment, pendingBalanceVes } satisfies PaymentMock;
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

    sale.paidVes = Math.round((sale.paidVes - payment.amountVes) * 100) / 100;

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

    purchase.paidVes = Math.round((purchase.paidVes - payment.amountVes) * 100) / 100;
    purchase.paidRef = Math.max(
      0,
      Math.round(((purchase.paidRef ?? 0) - payment.amountRef) * 100) / 100,
    );
  }

  payment.status = "anulado";
  payment.cancelledAt = new Date().toISOString();

  return getPaymentById(id, storeId);
}
