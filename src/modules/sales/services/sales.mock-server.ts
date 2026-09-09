import { ApiError } from "@/lib/api/apiError";
import { assertMockStoreResource } from "@/lib/api/assertStoreResource";
import { paginateList } from "@/lib/api/pagination";
import {
  mockContacts,
  mockPayments,
  mockProducts,
  mockSaleItems,
  mockSales,
  type SaleMock,
} from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";
import { isUtcTimestampInCaracasDateRange } from "@/shared/utils/caracasBusinessDay";

import type { PaymentInput } from "@/modules/payments/services/payments.mock-server";

/** Cobro que viaja con la venta: mismo contrato que `PaymentInput` sin documento. */
export type SalePaymentInput = Omit<PaymentInput, "purchaseId" | "saleId">;

export type SaleInput = Partial<
  Pick<SaleMock, "customerId" | "discountRef" | "refRateVes" | "taxRef">
> & {
  /** Clave de idempotencia por intento de cobro (uuid generado por el POS). */
  clientRequestId?: string;
  exchangeRateId?: string;
  invoiceNumber?: string;
  items?: Array<{
    productId: string;
    quantity: number;
    unitPriceRef?: number;
  }>;
  notes?: string;
  /** Cobros registrados en la misma transaccion que la venta. */
  payments?: SalePaymentInput[];
};

export type SaleUpdateInput = {
  notes?: string;
};

function matchesSaleSearch(
  sale: SaleMock,
  customerName: string | undefined,
  search: string,
) {
  const term = search.trim().toLowerCase();
  if (!term) {
    return true;
  }

  const invoice = sale.invoiceNumber.toLowerCase();
  const customer = (customerName ?? "").toLowerCase();

  return invoice.includes(term) || customer.includes(term);
}

export function listSales(searchParams: URLSearchParams, storeId: string) {
  const customerId = searchParams.get("customerId");
  const from = searchParams.get("from");
  const search = searchParams.get("search");
  const status = searchParams.get("status");
  const to = searchParams.get("to");

  const items = mockSales
    .filter((sale) => {
      const customer = mockContacts.find((contact) => contact.id === sale.customerId);

      return (
        (sale.storeId ?? DEFAULT_STORE_ID) === storeId &&
        (!status || sale.status === status) &&
        (!customerId || sale.customerId === customerId) &&
        isUtcTimestampInCaracasDateRange(sale.createdAt, from, to) &&
        (!search || matchesSaleSearch(sale, customer?.name, search))
      );
    })
    .map((sale) => ({
      ...sale,
      customer: mockContacts.find((contact) => contact.id === sale.customerId),
      itemsCount: mockSaleItems.filter((item) => item.saleId === sale.id).length,
    }));

  return paginateList(items, searchParams);
}

export function getSaleById(id: string, storeId: string) {
  const sale = mockSales.find((item) => item.id === id);
  assertMockStoreResource(sale, storeId, "Venta no encontrada.");

  const items = mockSaleItems
    .filter((item) => item.saleId === id)
    .map((item) => ({
      ...item,
      product: mockProducts.find((product) => product.id === item.productId),
    }));

  return {
    ...sale,
    customer: mockContacts.find((contact) => contact.id === sale.customerId),
    items,
    payments: mockPayments.filter((payment) => payment.saleId === id),
  };
}

/**
 * Ventas ya creadas por clave de idempotencia (`storeId:clientRequestId`), como
 * el indice unico `sales_store_client_request_unique` en la base: reintentar
 * devuelve la misma venta en vez de crear otra.
 */
const salesByClientRequest = new Map<string, SaleMock>();

/** Neto en Bs. que aporta una linea de cobro (recibido menos vuelto), como `register_payment`. */
function paymentNetVes(payment: SalePaymentInput, refRateVes: number) {
  const paysInUsd = payment.method === "efectivo_usd" || payment.currency === "USD";
  const receivedVes = paysInUsd
    ? Math.round(payment.amount * refRateVes * 100) / 100
    : Math.round(payment.amount * 100) / 100;
  const change = payment.change;
  const changeVes =
    change?.method && change.amount > 0
      ? change.method === "efectivo_usd"
        ? Math.round(change.amount * refRateVes * 100) / 100
        : Math.round(change.amount * 100) / 100
      : 0;

  return Math.round((receivedVes - changeVes) * 100) / 100;
}

export function createSale(input: SaleInput, storeId: string) {
  const requestKey = input.clientRequestId ? `${storeId}:${input.clientRequestId}` : null;
  const existing = requestKey ? salesByClientRequest.get(requestKey) : undefined;
  if (existing) {
    return existing;
  }

  const refRateVes = input.refRateVes ?? 510;
  const subtotalRef =
    input.items?.reduce((total, item) => {
      const product = mockProducts.find((candidate) => candidate.id === item.productId);
      return total + (product?.salePriceRef ?? 0) * item.quantity;
    }, 0) ?? 0;
  const totalRef = subtotalRef - (input.discountRef ?? 0) + (input.taxRef ?? 0);
  const totalVes = Math.round(totalRef * refRateVes * 100) / 100;

  // Cobros en la misma "transaccion": se validan todos antes de dar la venta por
  // creada, igual que `create_sale_with_payments` revierte la venta si uno falla.
  let paidVes = 0;
  for (const payment of input.payments ?? []) {
    const netVes = paymentNetVes(payment, refRateVes);
    if (netVes <= 0) {
      throw new ApiError(400, "BAD_REQUEST", "El monto del pago debe ser mayor a cero.");
    }
    paidVes = Math.round((paidVes + netVes) * 100) / 100;
  }
  if (paidVes > totalVes + 10) {
    throw new ApiError(
      400,
      "BAD_REQUEST",
      `El pago excede el saldo pendiente de la venta. Total: Bs ${totalVes}, cobrado: Bs ${paidVes}`,
    );
  }

  const sale = {
    createdAt: new Date().toISOString(),
    customerId: input.customerId ?? "cont-customer",
    discountRef: input.discountRef ?? 0,
    id: `sale-mock-${Date.now()}`,
    invoiceNumber: `V-MOCK-${Date.now()}`,
    paidVes,
    refRateVes,
    status: paidVes >= totalVes && totalVes > 0 ? "pagada" : "pendiente_pago",
    storeId,
    subtotalRef,
    taxRef: input.taxRef ?? 0,
    totalRef,
    totalVes,
    userId: "user-demo",
  } satisfies SaleMock;

  if (requestKey) {
    salesByClientRequest.set(requestKey, sale);
  }

  return sale;
}

export function updateSale(id: string, input: SaleUpdateInput, storeId: string) {
  const sale = getSaleById(id, storeId);

  return {
    ...sale,
    notes: input.notes,
  };
}

export function cancelSale(id: string, storeId: string) {
  return {
    ...getSaleById(id, storeId),
    status: "cancelada",
  };
}

export function returnSale(id: string, storeId: string) {
  const sale = getSaleById(id, storeId);

  return {
    sale: {
      ...sale,
      status: "devuelta",
    },
    stockMovements: sale.items.map((item) => ({
      createdAt: new Date().toISOString(),
      id: `mov-return-${item.productId}-${Date.now()}`,
      productId: item.productId,
      quantityDelta: item.quantity,
      reason: `Devolucion de venta ${sale.invoiceNumber}`,
      saleId: sale.id,
      storeId,
      type: "devolucion_cliente",
    })),
  };
}

export function getSaleReceipt(id: string, storeId: string) {
  const sale = getSaleById(id, storeId);

  return {
    customer: sale.customer,
    invoiceNumber: sale.invoiceNumber,
    items: sale.items,
    paidVes: sale.paidVes,
    pendingVes: sale.totalVes - sale.paidVes,
    saleId: sale.id,
    totalRef: sale.totalRef,
    totalVes: sale.totalVes,
  };
}
