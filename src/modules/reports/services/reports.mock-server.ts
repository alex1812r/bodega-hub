import { paginateList, type PaginatedList } from "@/lib/api/pagination";
import {
  mockContacts,
  mockPurchaseItems,
  mockPurchases,
  mockProducts,
  mockSaleItems,
  mockSales,
  mockStockMovements,
} from "@/shared/mocks/erp-data";

import {
  buildDailySalesSeries,
  buildGrossProfitSeries,
  buildPurchasesSeries,
  parseReportSeriesParams,
  resolvePurchasesReportStatuses,
  resolveReportSeriesRequest,
  SERIES_EXCLUDED_SALE_STATUSES,
  type DailySalesSeries,
  type GrossProfitSeries,
  type PurchasesSeries,
} from "./reportSeries";
import { matchesStoreIds, normalizeStoreIds } from "./storeScope";
import { isUtcTimestampInCaracasDateRange, toCaracasDateKey } from "@/shared/utils/caracasBusinessDay";
import { roundMoney } from "@/shared/utils/currency";

function isWithinDateRange(createdAt: string, from?: string | null, to?: string | null) {
  return isUtcTimestampInCaracasDateRange(createdAt, from, to);
}

function toStoreIds(storeIdOrIds: string | string[]) {
  return normalizeStoreIds(storeIdOrIds);
}

function isSeriesSale(status: string) {
  return !(SERIES_EXCLUDED_SALE_STATUSES as readonly string[]).includes(status);
}

function isDayWithinRange(day: string, from: string | null, to: string | null) {
  return (!from || day >= from) && (!to || day <= to);
}

/**
 * Lo que devuelve la vista `daily_sales_summary`: una fila por tienda y día
 * operativo de Caracas, sin ventas canceladas ni devueltas.
 */
function dailySalesSummaryRows(storeIds: string[]) {
  const byDay = new Map<
    string,
    {
      paidVes: number;
      saleDate: string;
      salesCount: number;
      storeId: (typeof mockSales)[number]["storeId"];
      totalRef: number;
      totalVes: number;
    }
  >();

  for (const sale of mockSales) {
    if (!matchesStoreIds(sale.storeId, storeIds) || !isSeriesSale(sale.status)) {
      continue;
    }

    const saleDate = toCaracasDateKey(sale.createdAt);
    const key = `${sale.storeId ?? ""}|${saleDate}`;
    const row = byDay.get(key) ?? {
      paidVes: 0,
      saleDate,
      salesCount: 0,
      storeId: sale.storeId,
      totalRef: 0,
      totalVes: 0,
    };

    byDay.set(key, {
      ...row,
      paidVes: roundMoney(row.paidVes + sale.paidVes),
      salesCount: row.salesCount + 1,
      totalRef: roundMoney(row.totalRef + sale.totalRef),
      totalVes: roundMoney(row.totalVes + sale.totalVes),
    });
  }

  return [...byDay.values()].sort((first, second) => second.saleDate.localeCompare(first.saleDate));
}

/**
 * Lo que devuelve la vista `gross_profit_summary`: una fila por tienda y día
 * operativo de Caracas con las líneas de las ventas no canceladas ni devueltas
 * (una venta sin líneas no aporta fila).
 */
function grossProfitSummaryRows(storeIds: string[]) {
  const byDay = new Map<
    string,
    {
      costRef: number;
      grossProfitRef: number;
      revenueRef: number;
      saleDate: string;
      storeId: (typeof mockSales)[number]["storeId"];
    }
  >();

  for (const sale of mockSales) {
    if (!matchesStoreIds(sale.storeId, storeIds) || !isSeriesSale(sale.status)) {
      continue;
    }

    const saleDate = toCaracasDateKey(sale.createdAt);
    const key = `${sale.storeId ?? ""}|${saleDate}`;

    for (const item of mockSaleItems) {
      if (item.saleId !== sale.id) {
        continue;
      }

      const row = byDay.get(key) ?? {
        costRef: 0,
        grossProfitRef: 0,
        revenueRef: 0,
        saleDate,
        storeId: sale.storeId,
      };
      const costRef = item.unitCostRefSnapshot * item.quantity;

      byDay.set(key, {
        ...row,
        costRef: roundMoney(row.costRef + costRef),
        grossProfitRef: roundMoney(row.grossProfitRef + item.subtotalRef - costRef),
        revenueRef: roundMoney(row.revenueRef + item.subtotalRef),
      });
    }
  }

  return [...byDay.values()].sort((first, second) => second.saleDate.localeCompare(first.saleDate));
}

/**
 * Tabla (`items`) y `series` salen de las mismas filas diarias, como en el
 * servidor (vista `daily_sales_summary`): el total del gráfico es la suma de la
 * tabla del rango. `series` solo con `from` + `to` y (`groupBy` o `compare`).
 */
export function getDailySalesReport(searchParams: URLSearchParams, storeIdOrIds: string | string[]) {
  const seriesRequest = resolveReportSeriesRequest(parseReportSeriesParams(searchParams));
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const dayRows = dailySalesSummaryRows(toStoreIds(storeIdOrIds));
  const items = dayRows.filter((row) => isDayWithinRange(row.saleDate, from, to));

  const list: PaginatedList<(typeof items)[number]> & { series?: DailySalesSeries } = paginateList(
    items,
    searchParams,
  );

  if (!seriesRequest) {
    return list;
  }

  return {
    ...list,
    series: buildDailySalesSeries(
      seriesRequest,
      dayRows.map((row) => ({
        day: row.saleDate,
        values: {
          count: row.salesCount,
          paidVes: row.paidVes,
          totalRef: row.totalRef,
          totalVes: row.totalVes,
        },
      })),
    ),
  };
}

/** Ganancia bruta: misma regla que `getDailySalesReport`, sobre `gross_profit_summary`. */
export function getGrossProfitReport(searchParams: URLSearchParams, storeIdOrIds: string | string[]) {
  const seriesRequest = resolveReportSeriesRequest(parseReportSeriesParams(searchParams));
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const dayRows = grossProfitSummaryRows(toStoreIds(storeIdOrIds));
  const items = dayRows.filter((row) => isDayWithinRange(row.saleDate, from, to));

  const list: PaginatedList<(typeof items)[number]> & { series?: GrossProfitSeries } = paginateList(
    items,
    searchParams,
  );

  if (!seriesRequest) {
    return list;
  }

  return {
    ...list,
    series: buildGrossProfitSeries(
      seriesRequest,
      dayRows.map((row) => ({
        day: row.saleDate,
        values: {
          costRef: row.costRef,
          grossProfitRef: row.grossProfitRef,
          revenueRef: row.revenueRef,
        },
      })),
    ),
  };
}

export function getProductProfitabilityReport(
  searchParams: URLSearchParams,
  storeIdOrIds: string | string[],
) {
  const storeIds = toStoreIds(storeIdOrIds);
  const items = mockProducts
    .filter((product) => matchesStoreIds(product.storeId, storeIds))
    .map((product) => {
      const items = mockSaleItems.filter((item) => item.productId === product.id);
      const revenueRef = items.reduce((total, item) => total + item.subtotalRef, 0);
      const costRef = items.reduce(
        (total, item) => total + item.unitCostRefSnapshot * item.quantity,
        0,
      );

      return {
        costRef,
        grossProfitRef: revenueRef - costRef,
        name: product.name,
        productId: product.id,
        revenueRef,
        sku: product.sku,
        storeId: product.storeId,
        unitsSold: items.reduce((total, item) => total + item.quantity, 0),
      };
    })
    .sort((first, second) => second.grossProfitRef - first.grossProfitRef);

  return paginateList(items, searchParams);
}

export function getLowStockReport(searchParams: URLSearchParams, storeIdOrIds: string | string[]) {
  const storeIds = toStoreIds(storeIdOrIds);
  const items = mockProducts.filter(
    (product) =>
      matchesStoreIds(product.storeId, storeIds) && product.currentStock <= product.minStock,
  );

  return paginateList(items, searchParams);
}

export function getStockCard(searchParams: URLSearchParams, storeIdOrIds: string | string[]) {
  const storeIds = toStoreIds(storeIdOrIds);
  const productId = searchParams.get("productId");
  // Como la vista `stock_card`: cada movimiento lleva el nombre y el SKU del producto.
  const items = mockStockMovements
    .filter(
      (movement) =>
        matchesStoreIds(movement.storeId, storeIds) &&
        (!productId || movement.productId === productId),
    )
    .map((movement) => {
      const product = mockProducts.find((item) => item.id === movement.productId);

      return { ...movement, productName: product?.name ?? "", sku: product?.sku ?? "" };
    });

  return paginateList(items, searchParams);
}

export function getCustomerPurchasesReport(
  searchParams: URLSearchParams,
  storeIdOrIds: string | string[],
) {
  const storeIds = toStoreIds(storeIdOrIds);
  const items = mockContacts
    .filter(
      (contact) =>
        matchesStoreIds(contact.storeId, storeIds) &&
        (contact.type === "cliente" || contact.type === "ambos"),
    )
    .map((contact) => {
      const sales = mockSales.filter((sale) => sale.customerId === contact.id);

      return {
        customerId: contact.id,
        lastPurchaseAt: sales.at(-1)?.createdAt,
        name: contact.name,
        pendingVes: sales.reduce((total, sale) => total + sale.totalVes - sale.paidVes, 0),
        salesCount: sales.length,
        storeId: contact.storeId,
        totalRef: sales.reduce((total, sale) => total + sale.totalRef, 0),
        totalVes: sales.reduce((total, sale) => total + sale.totalVes, 0),
      };
    });

  return paginateList(items, searchParams);
}

export function getSupplierPurchasesReport(
  searchParams: URLSearchParams,
  storeIdOrIds: string | string[],
) {
  const storeIds = toStoreIds(storeIdOrIds);
  const items = mockContacts
    .filter(
      (contact) =>
        matchesStoreIds(contact.storeId, storeIds) &&
        (contact.type === "proveedor" || contact.type === "ambos"),
    )
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
        storeId: contact.storeId,
        supplierId: contact.id,
        totalRef: purchases.reduce((total, purchase) => total + purchase.totalRef, 0),
        totalVes: purchases.reduce((total, purchase) => total + purchase.totalVes, 0),
      };
    });

  return paginateList(items, searchParams);
}

export function getTopProductsReport(searchParams: URLSearchParams, storeIdOrIds: string | string[]) {
  const storeIds = toStoreIds(storeIdOrIds);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  // Como el servidor: una venta cancelada o devuelta no entra en el ranking.
  const sales = mockSales.filter(
    (sale) =>
      matchesStoreIds(sale.storeId, storeIds) &&
      isSeriesSale(sale.status) &&
      isWithinDateRange(sale.createdAt, from, to),
  );
  const saleIds = new Set(sales.map((sale) => sale.id));

  const items = mockProducts
    .filter((product) => matchesStoreIds(product.storeId, storeIds))
    .map((product) => {
      const saleItems = mockSaleItems.filter(
        (item) => item.productId === product.id && saleIds.has(item.saleId),
      );

      return {
        name: product.name,
        productId: product.id,
        revenueRef: saleItems.reduce((total, item) => total + item.subtotalRef, 0),
        sku: product.sku,
        storeId: product.storeId,
        unitsSold: saleItems.reduce((total, item) => total + item.quantity, 0),
      };
    })
    .filter((item) => item.unitsSold > 0)
    .sort((first, second) => second.unitsSold - first.unitsSold);

  return paginateList(items, searchParams);
}

export function getTopCustomersReport(
  searchParams: URLSearchParams,
  storeIdOrIds: string | string[],
) {
  const storeIds = toStoreIds(storeIdOrIds);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  // Como el servidor: una venta cancelada o devuelta no entra en el ranking.
  const sales = mockSales.filter(
    (sale) =>
      matchesStoreIds(sale.storeId, storeIds) &&
      isSeriesSale(sale.status) &&
      isWithinDateRange(sale.createdAt, from, to),
  );

  const items = mockContacts
    .filter(
      (contact) =>
        matchesStoreIds(contact.storeId, storeIds) &&
        (contact.type === "cliente" || contact.type === "ambos"),
    )
    .map((contact) => {
      const customerSales = sales.filter((sale) => sale.customerId === contact.id);

      return {
        customerId: contact.id,
        name: contact.name,
        salesCount: customerSales.length,
        storeId: contact.storeId,
        totalRef: customerSales.reduce((total, sale) => total + sale.totalRef, 0),
        totalVes: customerSales.reduce((total, sale) => total + sale.totalVes, 0),
      };
    })
    .filter((item) => item.salesCount > 0)
    .sort((first, second) => second.totalVes - first.totalVes);

  return paginateList(items, searchParams);
}

/**
 * Compras por periodo. Como el servidor: la tabla y la serie parten de las
 * mismas compras (tienda, proveedor y `status`), así que el total de la serie
 * es la suma de la tabla del rango. Por defecto sin canceladas ni devueltas.
 */
export function getPurchasesReport(searchParams: URLSearchParams, storeIdOrIds: string | string[]) {
  const storeIds = toStoreIds(storeIdOrIds);
  const seriesRequest = resolveReportSeriesRequest(parseReportSeriesParams(searchParams));
  const from = searchParams.get("from");
  const supplierId = searchParams.get("supplierId");
  const to = searchParams.get("to");
  const statuses: readonly string[] = resolvePurchasesReportStatuses(searchParams);

  const purchases = mockPurchases.filter(
    (purchase) =>
      matchesStoreIds(purchase.storeId, storeIds) &&
      (!supplierId || purchase.supplierId === supplierId) &&
      statuses.includes(purchase.status),
  );

  const items = purchases
    .filter((purchase) => isWithinDateRange(purchase.createdAt, from, to))
    .map((purchase) => ({
      ...purchase,
      itemsCount: mockPurchaseItems.filter((item) => item.purchaseId === purchase.id).length,
      supplier: mockContacts.find((contact) => contact.id === purchase.supplierId),
    }));

  const list: PaginatedList<(typeof items)[number]> & { series?: PurchasesSeries } = paginateList(
    items,
    searchParams,
  );

  if (!seriesRequest) {
    return list;
  }

  return {
    ...list,
    series: buildPurchasesSeries(
      seriesRequest,
      purchases.map((purchase) => ({
        day: toCaracasDateKey(purchase.createdAt),
        values: { count: 1, totalRef: purchase.totalRef, totalVes: purchase.totalVes },
      })),
    ),
  };
}

export { getFxDepreciationReport } from "./fxDepreciationReport.mock-server";
export { getPaymentMethodsReport } from "./paymentMethodsReport.mock-server";
