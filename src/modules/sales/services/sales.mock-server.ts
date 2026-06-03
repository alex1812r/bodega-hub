import { ApiError } from "@/lib/api/apiError";
import { paginateList } from "@/lib/api/pagination";
import {
  mockContacts,
  mockPayments,
  mockProducts,
  mockSaleItems,
  mockSales,
  type SaleMock,
} from "@/shared/mocks/erp-data";

export type SaleInput = Partial<
  Pick<SaleMock, "customerId" | "discountRef" | "refRateVes" | "taxRef">
> & {
  exchangeRateId?: string;
  invoiceNumber?: string;
  items?: Array<{
    productId: string;
    quantity: number;
    unitPriceRef?: number;
  }>;
  notes?: string;
};

export type SaleUpdateInput = {
  notes?: string;
};

export function listSales(searchParams: URLSearchParams) {
  const customerId = searchParams.get("customerId");
  const from = searchParams.get("from");
  const status = searchParams.get("status");
  const to = searchParams.get("to");

  const items = mockSales
    .filter((sale) => {
      const saleDate = sale.createdAt.slice(0, 10);

      return (
        (!status || sale.status === status) &&
        (!customerId || sale.customerId === customerId) &&
        (!from || saleDate >= from) &&
        (!to || saleDate <= to)
      );
    })
    .map((sale) => ({
      ...sale,
      customer: mockContacts.find((contact) => contact.id === sale.customerId),
      itemsCount: mockSaleItems.filter((item) => item.saleId === sale.id).length,
    }));

  return paginateList(items, searchParams);
}

export function getSaleById(id: string) {
  const sale = mockSales.find((item) => item.id === id);

  if (!sale) {
    throw new ApiError(404, "NOT_FOUND", "Venta no encontrada.");
  }

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

export function createSale(input: SaleInput) {
  const refRateVes = input.refRateVes ?? 510;
  const subtotalRef =
    input.items?.reduce((total, item) => {
      const product = mockProducts.find((candidate) => candidate.id === item.productId);
      return total + (product?.salePriceRef ?? 0) * item.quantity;
    }, 0) ?? 0;
  const totalRef = subtotalRef - (input.discountRef ?? 0) + (input.taxRef ?? 0);

  return {
    createdAt: new Date().toISOString(),
    customerId: input.customerId ?? "cont-customer",
    discountRef: input.discountRef ?? 0,
    id: `sale-mock-${Date.now()}`,
    invoiceNumber: `V-MOCK-${Date.now()}`,
    paidVes: 0,
    refRateVes,
    status: "pendiente_pago",
    subtotalRef,
    taxRef: input.taxRef ?? 0,
    totalRef,
    totalVes: Math.round(totalRef * refRateVes * 100) / 100,
    userId: "user-demo",
  } satisfies SaleMock;
}

export function updateSale(id: string, input: SaleUpdateInput) {
  const sale = getSaleById(id);

  return {
    ...sale,
    notes: input.notes,
  };
}

export function cancelSale(id: string) {
  return {
    ...getSaleById(id),
    status: "cancelada",
  };
}

export function returnSale(id: string) {
  const sale = getSaleById(id);

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
      type: "devolucion_cliente",
    })),
  };
}

export function getSaleReceipt(id: string) {
  const sale = getSaleById(id);

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
