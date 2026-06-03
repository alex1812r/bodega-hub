import { paginateList } from "@/lib/api/pagination";
import { mockProducts, mockSaleItems, mockSales } from "@/shared/mocks/erp-data";

function isWithinDateRange(createdAt: string, from?: string | null, to?: string | null) {
  const date = createdAt.slice(0, 10);

  return (!from || date >= from) && (!to || date <= to);
}

export function getDashboardSummary() {
  const today = "2026-05-18";
  const todaysSales = mockSales.filter((sale) => sale.createdAt.startsWith(today));
  const totalRef = todaysSales.reduce((total, sale) => total + sale.totalRef, 0);
  const totalVes = todaysSales.reduce((total, sale) => total + sale.totalVes, 0);
  const lowStockCount = mockProducts.filter(
    (product) => product.currentStock <= product.minStock,
  ).length;

  return {
    lowStockCount,
    pendingSalesCount: mockSales.filter((sale) => sale.status === "pendiente_pago").length,
    salesCount: todaysSales.length,
    totalRef,
    totalVes,
  };
}

export function getDashboardMetrics(searchParams: URLSearchParams) {
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const sales = mockSales.filter((sale) => isWithinDateRange(sale.createdAt, from, to));
  const totalRef = sales.reduce((total, sale) => total + sale.totalRef, 0);
  const totalVes = sales.reduce((total, sale) => total + sale.totalVes, 0);
  const paidVes = sales.reduce((total, sale) => total + sale.paidVes, 0);
  const unitsSold = sales.reduce((total, sale) => {
    const saleItems = mockSaleItems.filter((item) => item.saleId === sale.id);
    return total + saleItems.reduce((itemTotal, item) => itemTotal + item.quantity, 0);
  }, 0);

  return {
    from,
    paidVes,
    pendingVes: totalVes - paidVes,
    salesCount: sales.length,
    to,
    totalRef,
    totalVes,
    unitsSold,
  };
}

export function getRecentSales(searchParams: URLSearchParams) {
  const items = [...mockSales].sort((first, second) =>
    second.createdAt.localeCompare(first.createdAt),
  );

  return paginateList(items, searchParams);
}

export function getDashboardLowStock(searchParams: URLSearchParams) {
  const items = mockProducts
    .filter((product) => product.currentStock <= product.minStock)
    .map((product) => ({
      currentStock: product.currentStock,
      id: product.id,
      minStock: product.minStock,
      name: product.name,
      sku: product.sku,
    }));

  return paginateList(items, searchParams);
}
