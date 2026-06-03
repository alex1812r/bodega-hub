import { paginateList } from "@/lib/api/pagination";
import {
  mockContacts,
  mockPurchaseItems,
  mockPurchases,
  mockProducts,
  mockSaleItems,
  mockSales,
  mockStockMovements,
} from "@/shared/mocks/erp-data";

function isWithinDateRange(createdAt: string, from?: string | null, to?: string | null) {
  const date = createdAt.slice(0, 10);

  return (!from || date >= from) && (!to || date <= to);
}

export function getDailySalesReport(searchParams: URLSearchParams) {
  const items = mockSales.map((sale) => ({
    paidVes: sale.paidVes,
    saleDate: sale.createdAt.slice(0, 10),
    salesCount: 1,
    totalRef: sale.totalRef,
    totalVes: sale.totalVes,
  }));

  return paginateList(items, searchParams);
}

export function getGrossProfitReport(searchParams: URLSearchParams) {
  const items = mockSales.map((sale) => {
    const items = mockSaleItems.filter((item) => item.saleId === sale.id);
    const costRef = items.reduce(
      (total, item) => total + item.unitCostRefSnapshot * item.quantity,
      0,
    );
    const revenueRef = items.reduce((total, item) => total + item.subtotalRef, 0);

    return {
      costRef,
      grossProfitRef: revenueRef - costRef,
      revenueRef,
      saleDate: sale.createdAt.slice(0, 10),
    };
  });

  return paginateList(items, searchParams);
}

export function getProductProfitabilityReport(searchParams: URLSearchParams) {
  const items = mockProducts.map((product) => {
    const items = mockSaleItems.filter((item) => item.productId === product.id);
    const revenueRef = items.reduce((total, item) => total + item.subtotalRef, 0);
    const costRef = items.reduce(
      (total, item) => total + item.unitCostRefSnapshot * item.quantity,
      0,
    );

    return {
      costRef,
      grossProfitRef: revenueRef - costRef,
      productId: product.id,
      sku: product.sku,
      unitsSold: items.reduce((total, item) => total + item.quantity, 0),
    };
  });

  return paginateList(items, searchParams);
}

export function getLowStockReport(searchParams: URLSearchParams) {
  const items = mockProducts.filter((product) => product.currentStock <= product.minStock);

  return paginateList(items, searchParams);
}

export function getStockCard(searchParams: URLSearchParams) {
  const productId = searchParams.get("productId");
  const items = mockStockMovements.filter((movement) => !productId || movement.productId === productId);

  return paginateList(items, searchParams);
}

export function getCustomerPurchasesReport(searchParams: URLSearchParams) {
  const items = mockContacts
    .filter((contact) => contact.type === "cliente" || contact.type === "ambos")
    .map((contact) => {
      const sales = mockSales.filter((sale) => sale.customerId === contact.id);

      return {
        customerId: contact.id,
        lastPurchaseAt: sales.at(-1)?.createdAt,
        name: contact.name,
        pendingVes: sales.reduce((total, sale) => total + sale.totalVes - sale.paidVes, 0),
        salesCount: sales.length,
        totalRef: sales.reduce((total, sale) => total + sale.totalRef, 0),
        totalVes: sales.reduce((total, sale) => total + sale.totalVes, 0),
      };
    });

  return paginateList(items, searchParams);
}

export function getSupplierPurchasesReport(searchParams: URLSearchParams) {
  const items = mockContacts
    .filter((contact) => contact.type === "proveedor" || contact.type === "ambos")
    .map((contact) => {
      const purchases = mockPurchases.filter((purchase) => purchase.supplierId === contact.id);

      return {
        lastPurchaseAt: purchases.at(-1)?.createdAt,
        name: contact.name,
        pendingVes: purchases.reduce(
          (total, purchase) => total + purchase.totalVes - purchase.paidVes,
          0,
        ),
        purchasesCount: purchases.length,
        supplierId: contact.id,
        totalRef: purchases.reduce((total, purchase) => total + purchase.totalRef, 0),
        totalVes: purchases.reduce((total, purchase) => total + purchase.totalVes, 0),
      };
    });

  return paginateList(items, searchParams);
}

export function getTopProductsReport(searchParams: URLSearchParams) {
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const sales = mockSales.filter((sale) => isWithinDateRange(sale.createdAt, from, to));
  const saleIds = new Set(sales.map((sale) => sale.id));

  const items = mockProducts
    .map((product) => {
      const saleItems = mockSaleItems.filter(
        (item) => item.productId === product.id && saleIds.has(item.saleId),
      );

      return {
        productId: product.id,
        revenueRef: saleItems.reduce((total, item) => total + item.subtotalRef, 0),
        sku: product.sku,
        unitsSold: saleItems.reduce((total, item) => total + item.quantity, 0),
      };
    })
    .filter((item) => item.unitsSold > 0)
    .sort((first, second) => second.unitsSold - first.unitsSold);

  return paginateList(items, searchParams);
}

export function getTopCustomersReport(searchParams: URLSearchParams) {
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const sales = mockSales.filter((sale) => isWithinDateRange(sale.createdAt, from, to));

  const items = mockContacts
    .filter((contact) => contact.type === "cliente" || contact.type === "ambos")
    .map((contact) => {
      const customerSales = sales.filter((sale) => sale.customerId === contact.id);

      return {
        customerId: contact.id,
        name: contact.name,
        salesCount: customerSales.length,
        totalRef: customerSales.reduce((total, sale) => total + sale.totalRef, 0),
        totalVes: customerSales.reduce((total, sale) => total + sale.totalVes, 0),
      };
    })
    .filter((item) => item.salesCount > 0)
    .sort((first, second) => second.totalVes - first.totalVes);

  return paginateList(items, searchParams);
}

export function getPurchasesReport(searchParams: URLSearchParams) {
  const from = searchParams.get("from");
  const supplierId = searchParams.get("supplierId");
  const to = searchParams.get("to");

  const items = mockPurchases
    .filter((purchase) => {
      return (
        (!supplierId || purchase.supplierId === supplierId) &&
        isWithinDateRange(purchase.createdAt, from, to)
      );
    })
    .map((purchase) => ({
      ...purchase,
      itemsCount: mockPurchaseItems.filter((item) => item.purchaseId === purchase.id).length,
      supplier: mockContacts.find((contact) => contact.id === purchase.supplierId),
    }));

  return paginateList(items, searchParams);
}
