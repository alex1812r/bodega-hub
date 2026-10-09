import { listCashRegisters } from "@/modules/cash/services/cash.registers.mock-server";
import { listRegisterSessions } from "@/modules/cash/services/cash.session.mock-server";
import { getBusinessTodayIsoDate } from "@/modules/dashboard/utils/businessDate";
import {
  buildOpenDocument,
  OPEN_PURCHASE_STATUSES,
  type OpenDocument,
} from "@/modules/payments/services/openDocuments.mock-server";
import {
  mockCategories,
  mockContacts,
  mockProducts,
  mockPurchases,
  mockSaleItems,
  mockSales,
} from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";
import {
  BUSINESS_TIMEZONE,
  isUtcTimestampInCaracasDateRange,
  toCaracasDateKey,
} from "@/shared/utils/caracasBusinessDay";
import { roundMoney } from "@/shared/utils/currency";

import {
  agingDocumentHref,
  buildAgingSummary,
  buildCashCloseDifferencesReport,
  buildSalesByCategoryReport,
  buildSalesByHourReport,
  CASH_CLOSE_CURRENCIES,
  isoDaysBetween,
  isoWeekday,
  resolveAgingBucket,
  UNCATEGORIZED_LABEL,
  type AgingDocumentRow,
  type AgingDocumentType,
  type AgingQuery,
  type AgingReport,
  type CashCloseCurrency,
  type CashCloseCurrencyWindow,
  type CashCloseDifferencesQuery,
  type CashCloseDifferencesReport,
  type CashCloseLedgerRow,
  type MoneyReportRange,
  type SalesByCategoryReport,
  type SalesByHourReport,
} from "./moneyReports";
import { SERIES_EXCLUDED_SALE_STATUSES } from "./reportSeries";

/**
 * Mock de los reportes de dinero (REP-06): mismas formas y reglas que
 * `moneyReports.server.ts`, sobre los datos en memoria.
 */

const caracasHourFormatter = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  hourCycle: "h23",
  timeZone: BUSINESS_TIMEZONE,
});

function caracasHour(isoTimestamp: string) {
  return Number(caracasHourFormatter.format(new Date(isoTimestamp)));
}

function inStore(entityStoreId: string | null | undefined, storeId: string) {
  return (entityStoreId ?? DEFAULT_STORE_ID) === storeId;
}

/** Ventas del rango que cuentan como venta: ni canceladas ni devueltas. */
function reportSales(range: MoneyReportRange, storeId: string) {
  return mockSales.filter(
    (sale) =>
      inStore(sale.storeId, storeId) &&
      !(SERIES_EXCLUDED_SALE_STATUSES as readonly string[]).includes(sale.status) &&
      isUtcTimestampInCaracasDateRange(sale.createdAt, range.from, range.to),
  );
}

export function getSalesByHourReport(range: MoneyReportRange, storeId: string): SalesByHourReport {
  return buildSalesByHourReport(
    range,
    reportSales(range, storeId).map((sale) => ({
      dow: isoWeekday(toCaracasDateKey(sale.createdAt)),
      hour: caracasHour(sale.createdAt),
      salesCount: 1,
      totalRef: sale.totalRef,
      totalVes: sale.totalVes,
    })),
  );
}

export function getSalesByCategoryReport(
  range: MoneyReportRange,
  storeId: string,
): SalesByCategoryReport {
  const saleIds = new Set(reportSales(range, storeId).map((sale) => sale.id));

  return buildSalesByCategoryReport(
    range,
    mockSaleItems
      .filter((item) => saleIds.has(item.saleId))
      .map((item) => {
        const product = mockProducts.find((candidate) => candidate.id === item.productId);
        const category = mockCategories.find((candidate) => candidate.id === product?.categoryId);
        const costRef = item.unitCostRefSnapshot * item.quantity;

        return {
          categoryId: product?.categoryId || null,
          categoryName: category?.name ?? UNCATEGORIZED_LABEL,
          costRef,
          grossProfitRef: item.subtotalRef - costRef,
          revenueRef: item.subtotalRef,
          units: item.quantity,
        };
      }),
  );
}

// ---------------------------------------------------------------------------
// Cuentas por cobrar / por pagar
// ---------------------------------------------------------------------------

/**
 * Documentos abiertos con el criterio de Pagos (`buildOpenDocument`): ventas
 * `pendiente_pago` y compras `pedido` / `recibido` con saldo en Bs, igual que
 * `openDocuments.server.ts`.
 */
function openDocuments(type: AgingDocumentType, storeId: string): OpenDocument[] {
  const documents =
    type === "sale"
      ? mockSales
          .filter((sale) => inStore(sale.storeId, storeId) && sale.status === "pendiente_pago")
          .map((sale) =>
            buildOpenDocument({
              contact: mockContacts.find((contact) => contact.id === sale.customerId),
              createdAt: sale.createdAt,
              id: sale.id,
              number: sale.invoiceNumber,
              paidVes: sale.paidVes,
              refRateVes: sale.refRateVes,
              status: sale.status,
              totalRef: sale.totalRef,
              totalVes: sale.totalVes,
              type,
            }),
          )
      : mockPurchases
          .filter(
            (purchase) =>
              inStore(purchase.storeId, storeId) && OPEN_PURCHASE_STATUSES.includes(purchase.status),
          )
          .map((purchase) =>
            buildOpenDocument({
              contact: mockContacts.find((contact) => contact.id === purchase.supplierId),
              createdAt: purchase.createdAt,
              id: purchase.id,
              number: purchase.purchaseNumber,
              paidRef: purchase.paidRef,
              paidVes: purchase.paidVes,
              refRateVes: purchase.refRateVes,
              status: purchase.status,
              totalRef: purchase.totalRef,
              totalVes: purchase.totalVes,
              type,
            }),
          );

  return documents.filter((document): document is OpenDocument => document !== null);
}

function toAgingRow(document: OpenDocument, today: string): AgingDocumentRow {
  const date = toCaracasDateKey(document.createdAt);
  const days = isoDaysBetween(date, today);
  const pendingRef = document.pendingRef ?? 0;

  return {
    bucket: resolveAgingBucket(days),
    contact: document.contact ? { id: document.contact.id, name: document.contact.name } : null,
    createdAt: document.createdAt,
    date,
    days,
    document: {
      href: agingDocumentHref(document.type, document.id),
      id: document.id,
      number: document.number,
      type: document.type,
    },
    paidRef:
      document.type === "purchase"
        ? (document.paidRef ?? 0)
        : Math.max(roundMoney(document.totalRef - pendingRef), 0),
    paidVes: document.paidVes,
    pendingRef,
    pendingVes: document.pendingVes,
    refRateVes: document.refRateVes,
    totalRef: document.totalRef,
    totalVes: document.totalVes,
  };
}

function getAgingReport(
  type: AgingDocumentType,
  query: AgingQuery,
  storeId: string,
  today: string,
): AgingReport {
  const contactIdOf = new Map<string, string>(
    type === "sale"
      ? mockSales.map((sale) => [sale.id, sale.customerId])
      : mockPurchases.map((purchase) => [purchase.id, purchase.supplierId]),
  );
  const rows = openDocuments(type, storeId)
    .map((document) => toAgingRow(document, today))
    .filter((row) => !query.contactId || contactIdOf.get(row.document.id) === query.contactId)
    .sort(
      (first, second) =>
        Date.parse(first.createdAt) - Date.parse(second.createdAt) ||
        first.document.id.localeCompare(second.document.id),
    );
  const filtered = query.bucket ? rows.filter((row) => row.bucket === query.bucket) : rows;

  return {
    items: filtered.slice(query.skip, query.skip + query.limit),
    limit: query.limit,
    skip: query.skip,
    summary: buildAgingSummary(
      rows.map((row) => ({
        bucket: row.bucket,
        documentsCount: 1,
        pendingRef: row.pendingRef,
        pendingVes: row.pendingVes,
      })),
    ),
    total: filtered.length,
  };
}

/** `today`: día operativo Caracas desde el que se cuentan los días (fijo en mock). */
export function getReceivablesAgingReport(
  query: AgingQuery,
  storeId: string,
  today: string = getBusinessTodayIsoDate(),
) {
  return getAgingReport("sale", query, storeId, today);
}

export function getPayablesAgingReport(
  query: AgingQuery,
  storeId: string,
  today: string = getBusinessTodayIsoDate(),
) {
  return getAgingReport("purchase", query, storeId, today);
}

// ---------------------------------------------------------------------------
// Diferencias de cierre de caja
// ---------------------------------------------------------------------------

/** Cierres × moneda de la tienda en orden de cierre, con sus acumulados (como la vista). */
function cashCloseLedger(storeId: string): CashCloseLedgerRow[] {
  const sessions = listCashRegisters(storeId)
    .flatMap((register) => listRegisterSessions(register.id, storeId, Number.MAX_SAFE_INTEGER))
    .filter((session) => session.status === "closed" && session.closedAt)
    .sort(
      (first, second) =>
        Date.parse(first.closedAt!) - Date.parse(second.closedAt!) || first.id.localeCompare(second.id),
    );
  const running: Record<CashCloseCurrency, { counted: number; difference: number; expected: number }> = {
    ref: { counted: 0, difference: 0, expected: 0 },
    ves: { counted: 0, difference: 0, expected: 0 },
  };
  const ledger: CashCloseLedgerRow[] = [];

  for (const session of sessions) {
    for (const currency of CASH_CLOSE_CURRENCIES) {
      const expected = currency === "ves" ? session.theoreticalClosingVes : session.theoreticalClosingRef;
      const counted = currency === "ves" ? session.closingVes : session.closingRef;

      if (expected == null || counted == null) {
        continue;
      }

      const totals = running[currency];
      totals.counted = roundMoney(totals.counted + counted);
      totals.expected = roundMoney(totals.expected + expected);
      totals.difference = roundMoney(totals.difference + (counted - expected));

      ledger.push({
        cashSessionId: session.id,
        closeDate: toCaracasDateKey(session.closedAt!),
        closedAt: session.closedAt!,
        closedReason: session.closedReason ?? null,
        counted,
        currency,
        difference: roundMoney(counted - expected),
        expected,
        registerId: session.registerId,
        registerName: session.register.name,
        runningCounted: totals.counted,
        runningDifference: totals.difference,
        runningExpected: totals.expected,
      });
    }
  }

  return ledger;
}

function toRunning(row: CashCloseLedgerRow | undefined) {
  return row
    ? { counted: row.runningCounted, difference: row.runningDifference, expected: row.runningExpected }
    : null;
}

export function getCashCloseDifferencesReport(
  query: CashCloseDifferencesQuery,
  storeId: string,
): CashCloseDifferencesReport {
  const ledger = cashCloseLedger(storeId);
  const inRange = ledger.filter(
    (row) => (!query.from || row.closeDate >= query.from) && (!query.to || row.closeDate <= query.to),
  );

  const window = (currency: CashCloseCurrency): CashCloseCurrencyWindow => {
    const rows = inRange.filter((row) => row.currency === currency);
    const before = query.from
      ? ledger.filter((row) => row.currency === currency && row.closeDate < query.from!)
      : [];

    return {
      baseline: toRunning(before.at(-1)),
      last: toRunning(rows.at(-1)),
      sessionsCount: rows.length,
    };
  };

  // Del cierre más reciente al más antiguo; dentro de una sesión, `ref` antes que `ves`.
  const listed = (query.currency ? inRange.filter((row) => row.currency === query.currency) : inRange)
    .slice()
    .sort(
      (first, second) =>
        Date.parse(second.closedAt) - Date.parse(first.closedAt) ||
        second.cashSessionId.localeCompare(first.cashSessionId) ||
        first.currency.localeCompare(second.currency),
    );

  return buildCashCloseDifferencesReport({
    page: listed.slice(query.skip, query.skip + query.limit),
    query,
    total: listed.length,
    windows: { ref: window("ref"), ves: window("ves") },
  });
}
