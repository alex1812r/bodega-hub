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

/** Quien pide la venta (mismo contrato que `SaleViewer` del server real). */
export type SaleMockViewer = {
  role?: string;
  userId?: string;
};

type SaleByClientRequest = {
  /** Huella del contenido (cliente, lineas, descuento, impuesto, pagos), como `sales.client_request_hash`. */
  contentHash: string;
  items: NonNullable<SaleInput["items"]>;
  sale: SaleMock;
};

/**
 * Ventas ya creadas por clave de idempotencia (`storeId:clientRequestId`), como
 * el indice unico `sales_store_client_request_unique` en la base: reintentar con
 * el mismo contenido devuelve la misma venta en vez de crear otra.
 */
const salesByClientRequest = new Map<string, SaleByClientRequest>();

const IDEMPOTENCY_KEY_CONFLICT_MESSAGE =
  "La clave de idempotencia ya se uso en otra venta. Revisa la venta registrada antes de reintentar.";

function saleContentHash(input: SaleInput) {
  return JSON.stringify({
    customerId: input.customerId ?? null,
    discountRef: input.discountRef ?? 0,
    items: (input.items ?? [])
      .map((item) => [item.productId, item.quantity, item.unitPriceRef ?? null])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
    payments: (input.payments ?? []).map((payment) => [
      payment.method,
      payment.amount,
      payment.currency ?? null,
      payment.change?.method ?? null,
      payment.change?.amount ?? 0,
    ]),
    taxRef: input.taxRef ?? 0,
  });
}

function toCreatedSaleDetail(entry: SaleByClientRequest) {
  return {
    ...entry.sale,
    customer: mockContacts.find((contact) => contact.id === entry.sale.customerId),
    items: entry.items.map((item) => {
      const product = mockProducts.find((candidate) => candidate.id === item.productId);
      const unitPriceRef = item.unitPriceRef ?? product?.salePriceRef ?? 0;
      const subtotalRef = unitPriceRef * item.quantity;

      return {
        product,
        productId: item.productId,
        quantity: item.quantity,
        saleId: entry.sale.id,
        subtotalRef,
        subtotalVes: Math.round(subtotalRef * entry.sale.refRateVes * 100) / 100,
        unitCostRefSnapshot: 0,
        unitPriceRef,
      };
    }),
    payments: mockPayments.filter((payment) => payment.saleId === entry.sale.id),
  };
}

/** Venta creada con clave en esta sesion del mock (no vive en `mockSales`). */
function findCreatedSale(id: string, storeId: string) {
  for (const entry of salesByClientRequest.values()) {
    if (entry.sale.id === id && (entry.sale.storeId ?? DEFAULT_STORE_ID) === storeId) {
      return entry;
    }
  }

  return undefined;
}

/**
 * Venta por clave de idempotencia, en la misma forma que `getSaleById`. 404 si
 * no existe en la tienda o si es de otro usuario (salvo admin).
 */
export function getSaleByClientRequestId(
  clientRequestId: string,
  storeId: string,
  viewer: SaleMockViewer = {},
) {
  const entry = salesByClientRequest.get(`${storeId}:${clientRequestId}`);
  const visible =
    viewer.role === "admin" || (Boolean(viewer.userId) && entry?.sale.userId === viewer.userId);

  if (!entry || !visible) {
    throw new ApiError(404, "NOT_FOUND", "Venta no encontrada.");
  }

  return toCreatedSaleDetail(entry);
}

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

export function createSale(input: SaleInput, storeId: string, viewer: SaleMockViewer = {}) {
  if (!input.clientRequestId) {
    throw new ApiError(400, "BAD_REQUEST", "La venta requiere clientRequestId (clave de idempotencia).");
  }

  const userId = viewer.userId ?? "user-demo";
  const requestKey = `${storeId}:${input.clientRequestId}`;
  const contentHash = saleContentHash(input);
  const existing = salesByClientRequest.get(requestKey);
  if (existing) {
    // Misma regla que el RPC (C4): solo se devuelve la venta previa si es el mismo
    // contenido, del mismo usuario y sigue viva; cualquier otro caso es 409.
    const reusable =
      existing.contentHash === contentHash &&
      existing.sale.userId === userId &&
      existing.sale.status !== "cancelada" &&
      existing.sale.status !== "devuelta";

    if (!reusable) {
      throw new ApiError(409, "CONFLICT", IDEMPOTENCY_KEY_CONFLICT_MESSAGE);
    }

    return existing.sale;
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
    // El contador evita ids repetidos entre ventas creadas en el mismo milisegundo.
    id: `sale-mock-${Date.now()}-${salesByClientRequest.size + 1}`,
    invoiceNumber: `V-MOCK-${Date.now()}`,
    paidVes,
    refRateVes,
    status: paidVes >= totalVes && totalVes > 0 ? "pagada" : "pendiente_pago",
    storeId,
    subtotalRef,
    taxRef: input.taxRef ?? 0,
    totalRef,
    totalVes,
    userId,
  } satisfies SaleMock;

  salesByClientRequest.set(requestKey, { contentHash, items: input.items ?? [], sale });

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
  const created = findCreatedSale(id, storeId);
  if (created) {
    created.sale = { ...created.sale, status: "cancelada" };
    return toCreatedSaleDetail(created);
  }

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
