import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { getProductSales } from "./products.mock-server";
import {
  buildProductSaleHistoryResult,
  computeProductSaleHistoryTotals,
  joinProductSaleItems,
  mapProductSaleHistoryRow,
  type ProductSaleHistoryItemInput,
  type ProductSaleHistorySaleInput,
} from "./productSales";

const storeId = DEFAULT_STORE_ID;

const paidSale: ProductSaleHistorySaleInput = {
  createdAt: "2026-05-18T15:10:00.000Z",
  id: "sale-paid",
  invoiceNumber: "V-000002",
  status: "pagada",
  storeId,
};

const cancelledSale: ProductSaleHistorySaleInput = {
  createdAt: "2026-05-16T11:45:00.000Z",
  id: "sale-cancelled",
  invoiceNumber: "V-000004",
  status: "cancelada",
  storeId,
};

const olderPaidSale: ProductSaleHistorySaleInput = {
  createdAt: "2026-05-14T16:30:00.000Z",
  id: "sale-older",
  invoiceNumber: "V-000006",
  status: "pagada",
  storeId,
};

const paidItem: ProductSaleHistoryItemInput = {
  id: "item-paid",
  quantity: 1,
  saleId: paidSale.id,
  subtotalRef: 20,
  subtotalVes: 10200,
  unitPriceRef: 20,
};

const cancelledItem: ProductSaleHistoryItemInput = {
  id: "item-cancelled",
  quantity: 2,
  saleId: cancelledSale.id,
  subtotalRef: 40,
  subtotalVes: 20080,
  unitPriceRef: 20,
};

const olderPaidItem: ProductSaleHistoryItemInput = {
  id: "item-older",
  quantity: 3,
  saleId: olderPaidSale.id,
  subtotalRef: 24,
  subtotalVes: 11904,
  unitPriceRef: 8,
};

describe("product sales history mapping", () => {
  it("joins sale_items with sales", () => {
    const salesById = new Map([
      [paidSale.id, paidSale],
      [cancelledSale.id, cancelledSale],
    ]);

    const rows = joinProductSaleItems([paidItem, cancelledItem], salesById, storeId);

    expect(rows).toEqual([
      expect.objectContaining({
        id: "item-paid",
        invoiceNumber: "V-000002",
        quantity: 1,
        saleId: "sale-paid",
        status: "pagada",
        subtotalRef: 20,
        subtotalVes: 10200,
        unitPriceRef: 20,
      }),
      expect.objectContaining({
        id: "item-cancelled",
        invoiceNumber: "V-000004",
        status: "cancelada",
      }),
    ]);
  });

  it("skips items whose sale is missing or belongs to another store", () => {
    const otherStoreSale: ProductSaleHistorySaleInput = {
      ...paidSale,
      storeId: "store-other",
    };

    expect(
      joinProductSaleItems(
        [paidItem, cancelledItem],
        new Map([[cancelledSale.id, cancelledSale], [paidSale.id, otherStoreSale]]),
        storeId,
      ),
    ).toEqual([expect.objectContaining({ id: "item-cancelled" })]);
  });

  it("maps a sale_item + sale into the API row shape", () => {
    expect(mapProductSaleHistoryRow(paidItem, paidSale)).toEqual({
      createdAt: paidSale.createdAt,
      id: "item-paid",
      invoiceNumber: "V-000002",
      quantity: 1,
      saleId: "sale-paid",
      status: "pagada",
      subtotalRef: 20,
      subtotalVes: 10200,
      unitPriceRef: 20,
    });
  });

  it("shows cancelled rows but excludes them from totals", () => {
    const rows = joinProductSaleItems(
      [paidItem, cancelledItem, olderPaidItem],
      new Map([
        [paidSale.id, paidSale],
        [cancelledSale.id, cancelledSale],
        [olderPaidSale.id, olderPaidSale],
      ]),
      storeId,
    );

    expect(rows.map((row) => row.status)).toEqual(["pagada", "cancelada", "pagada"]);
    expect(computeProductSaleHistoryTotals(rows)).toEqual({
      totalRef: 44,
      totalVes: 22104,
      units: 4,
    });
  });

  it("paginates after computing totals for all matching items", () => {
    const rows = joinProductSaleItems(
      [paidItem, cancelledItem, olderPaidItem],
      new Map([
        [paidSale.id, paidSale],
        [cancelledSale.id, cancelledSale],
        [olderPaidSale.id, olderPaidSale],
      ]),
      storeId,
    );

    const page = buildProductSaleHistoryResult(rows, new URLSearchParams("skip=1"));

    expect(page.skip).toBe(1);
    expect(page.limit).toBe(10);
    expect(page.total).toBe(3);
    expect(page.items).toHaveLength(2);
    expect(page.items[0]).toEqual(expect.objectContaining({ id: "item-cancelled" }));
    expect(page.totals).toEqual({
      totalRef: 44,
      totalVes: 22104,
      units: 4,
    });
  });

  it("orders by created_at descending before paginating", () => {
    const page = buildProductSaleHistoryResult(
      joinProductSaleItems(
        [olderPaidItem, cancelledItem, paidItem],
        new Map([
          [paidSale.id, paidSale],
          [cancelledSale.id, cancelledSale],
          [olderPaidSale.id, olderPaidSale],
        ]),
        storeId,
      ),
      new URLSearchParams(),
    );

    expect(page.items.map((row) => row.saleId)).toEqual([
      "sale-paid",
      "sale-cancelled",
      "sale-older",
    ]);
  });
});

describe("getProductSales mock", () => {
  it("joins mock sale_items with sales and excludes cancelada from totals", () => {
    const result = getProductSales("prod-paint", new URLSearchParams(), storeId);

    expect(result.items).toEqual([
      expect.objectContaining({
        invoiceNumber: "V-000002",
        quantity: 1,
        saleId: "sale-002",
        status: "pendiente_pago",
        subtotalRef: 20,
        subtotalVes: 10200,
      }),
      expect.objectContaining({
        invoiceNumber: "V-000004",
        quantity: 2,
        saleId: "sale-004",
        status: "cancelada",
        subtotalRef: 40,
      }),
    ]);
    expect(result.total).toBe(2);
    expect(result.totals).toEqual({
      totalRef: 20,
      totalVes: 10200,
      units: 1,
    });
  });

  it("keeps cancelled totals out of a later page", () => {
    const result = getProductSales("prod-paint", new URLSearchParams("skip=1"), storeId);

    expect(result.items).toEqual([
      expect.objectContaining({ saleId: "sale-004", status: "cancelada" }),
    ]);
    expect(result.totals).toEqual({
      totalRef: 20,
      totalVes: 10200,
      units: 1,
    });
  });
});
