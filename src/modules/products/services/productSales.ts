import { paginateList, type PaginatedList } from "@/lib/api/pagination";
import type { SaleStatus } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";
import { roundMoney } from "@/shared/utils/currency";

export const CANCELLED_SALE_STATUS: SaleStatus = "cancelada";

export type ProductSaleHistoryRow = {
  createdAt: string;
  id: string;
  invoiceNumber: string;
  quantity: number;
  saleId: string;
  status: SaleStatus;
  subtotalRef: number;
  subtotalVes: number;
  unitPriceRef: number;
};

export type ProductSaleHistoryTotals = {
  totalRef: number;
  totalVes: number;
  units: number;
};

export type ProductSaleHistoryResult = PaginatedList<ProductSaleHistoryRow> & {
  totals: ProductSaleHistoryTotals;
};

export type ProductSaleHistoryItemInput = {
  id: string;
  quantity: number;
  saleId: string;
  subtotalRef: number;
  subtotalVes: number;
  unitPriceRef: number;
};

export type ProductSaleHistorySaleInput = {
  createdAt: string;
  id: string;
  invoiceNumber: string;
  status: string;
  storeId?: string | null;
};

export function isCancelledSaleStatus(status: string) {
  return status === CANCELLED_SALE_STATUS;
}

export function mapProductSaleHistoryRow(
  item: ProductSaleHistoryItemInput,
  sale: ProductSaleHistorySaleInput,
): ProductSaleHistoryRow {
  return {
    createdAt: sale.createdAt,
    id: item.id,
    invoiceNumber: sale.invoiceNumber,
    quantity: item.quantity,
    saleId: item.saleId,
    status: sale.status as SaleStatus,
    subtotalRef: Number(item.subtotalRef),
    subtotalVes: Number(item.subtotalVes),
    unitPriceRef: Number(item.unitPriceRef),
  };
}

export function joinProductSaleItems(
  items: ProductSaleHistoryItemInput[],
  salesById: Map<string, ProductSaleHistorySaleInput>,
  storeId: string,
): ProductSaleHistoryRow[] {
  return items.flatMap((item) => {
    const sale = salesById.get(item.saleId);

    if (!sale || (sale.storeId ?? DEFAULT_STORE_ID) !== storeId) {
      return [];
    }

    return [mapProductSaleHistoryRow(item, sale)];
  });
}

export function computeProductSaleHistoryTotals(
  rows: ProductSaleHistoryRow[],
): ProductSaleHistoryTotals {
  return rows.reduce<ProductSaleHistoryTotals>(
    (totals, row) => {
      if (isCancelledSaleStatus(row.status)) {
        return totals;
      }

      return {
        totalRef: roundMoney(totals.totalRef + row.subtotalRef),
        totalVes: roundMoney(totals.totalVes + row.subtotalVes),
        units: totals.units + row.quantity,
      };
    },
    { totalRef: 0, totalVes: 0, units: 0 },
  );
}

export function buildProductSaleHistoryResult(
  rows: ProductSaleHistoryRow[],
  searchParams: URLSearchParams,
): ProductSaleHistoryResult {
  const sorted = [...rows].sort((first, second) => {
    const byDate = second.createdAt.localeCompare(first.createdAt);
    return byDate !== 0 ? byDate : second.id.localeCompare(first.id);
  });

  return {
    ...paginateList(sorted, searchParams),
    totals: computeProductSaleHistoryTotals(sorted),
  };
}
