import { isMockDataSource } from "@/lib/api/dataSourceUi";
import { paginateList } from "@/lib/api/pagination";
import {
  mockContacts,
  mockProducts,
  mockSaleItems,
  mockSales,
} from "@/shared/mocks/erp-data";

import { getBusinessTodayIsoDate, shiftIsoDate } from "../utils/businessDate";
import { buildDemoSalesTrend } from "../utils/demoChartSeries";

function isWithinDateRange(createdAt: string, from?: string | null, to?: string | null) {
  const date = createdAt.slice(0, 10);

  return (!from || date >= from) && (!to || date <= to);
}

function sumSalesTotalRef(sales: typeof mockSales) {
  return sales.reduce((total, sale) => total + sale.totalRef, 0);
}

export function getDashboardSummary() {
  const today = getBusinessTodayIsoDate();
  const yesterday = shiftIsoDate(today, -1);
  const todaysSales = mockSales.filter((sale) => sale.createdAt.startsWith(today));
  const yesterdaysSales = mockSales.filter((sale) => sale.createdAt.startsWith(yesterday));
  const totalRef = sumSalesTotalRef(todaysSales);
  const totalVes = todaysSales.reduce((total, sale) => total + sale.totalVes, 0);
  const previousDayTotalRef = sumSalesTotalRef(yesterdaysSales);
  const lowStockCount = mockProducts.filter(
    (product) => product.currentStock <= product.minStock,
  ).length;
  const dayOverDayChangePercent =
    previousDayTotalRef > 0
      ? ((totalRef - previousDayTotalRef) / previousDayTotalRef) * 100
      : totalRef > 0
        ? 12.5
        : null;

  const activeCustomers = mockContacts.filter(
    (contact) => contact.isActive && (contact.type === "cliente" || contact.type === "ambos"),
  ).length;

  return {
    activeCustomers,
    dayOverDayChangePercent,
    lowStockCount,
    pendingSalesCount: mockSales.filter((sale) => sale.status === "pendiente_pago").length,
    previousDayTotalRef,
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

function getContactName(contactId: string) {
  return mockContacts.find((contact) => contact.id === contactId)?.name ?? "Sin cliente";
}

export function getDashboardSalesTrend(searchParams: URLSearchParams) {
  const from = searchParams.get("from") ?? getBusinessTodayIsoDate();
  const to = searchParams.get("to") ?? getBusinessTodayIsoDate();

  if (isMockDataSource()) {
    return { items: buildDemoSalesTrend(from, to) };
  }

  const byDate = new Map<
    string,
    { paidVes: number; saleDate: string; salesCount: number; totalRef: number; totalVes: number }
  >();

  for (const sale of mockSales) {
    if (!isWithinDateRange(sale.createdAt, from, to)) {
      continue;
    }

    const saleDate = sale.createdAt.slice(0, 10);
    const current = byDate.get(saleDate) ?? {
      paidVes: 0,
      saleDate,
      salesCount: 0,
      totalRef: 0,
      totalVes: 0,
    };

    current.salesCount += 1;
    current.totalRef += sale.totalRef;
    current.totalVes += sale.totalVes;
    current.paidVes += sale.paidVes;
    byDate.set(saleDate, current);
  }

  return {
    items: [...byDate.values()].sort((first, second) =>
      first.saleDate.localeCompare(second.saleDate),
    ),
  };
}

export function getRecentSales(searchParams: URLSearchParams) {
  const items = [...mockSales]
    .sort((first, second) => second.createdAt.localeCompare(first.createdAt))
    .map((sale) => ({
      createdAt: sale.createdAt,
      customerName: getContactName(sale.customerId),
      id: sale.id,
      invoiceNumber: sale.invoiceNumber,
      status: sale.status,
      totalRef: sale.totalRef,
    }));

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
