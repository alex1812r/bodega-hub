import { ApiError } from "@/lib/api/apiError";
import { assertMockStoreResource } from "@/lib/api/assertStoreResource";
import { paginateList } from "@/lib/api/pagination";
import {
  mockContacts,
  mockPayments,
  mockProducts,
  mockPurchaseItems,
  mockPurchases,
  type PurchaseItemMock,
  type PurchaseMock,
} from "@/shared/mocks/erp-data";
import {
  findActiveMockTaxRateByCode,
  findMockTaxRateForPct,
} from "@/modules/settings/services/taxRates.mock-server";
import { normalizeTaxRatePct } from "@/modules/settings/services/taxRates.schemas";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";
import { isUtcTimestampInCaracasDateRange } from "@/shared/utils/caracasBusinessDay";
import { roundMoney } from "@/shared/utils/currency";

import type { PurchaseItemInput } from "../schemas/purchaseItem.schema";
import { normalizePurchaseLine } from "../schemas/purchaseItem.schema";

export type PurchaseInput = Partial<
  Pick<
    PurchaseMock,
    | "discountRef"
    | "discountVes"
    | "refRateVes"
    | "status"
    | "subtotalRef"
    | "subtotalVes"
    | "supplierId"
    | "taxRef"
    | "taxVes"
  >
> & {
  /** Clave de idempotencia del intento (C6). */
  clientRequestId?: string;
  exchangeRateId?: string;
  items?: PurchaseItemInput[];
  notes?: string;
  purchaseNumber?: string;
};

function matchesPurchaseSearch(
  purchase: PurchaseMock,
  supplierName: string | undefined,
  search: string,
) {
  const term = search.trim().toLowerCase();
  if (!term) {
    return true;
  }

  const number = purchase.purchaseNumber.toLowerCase();
  const supplier = (supplierName ?? "").toLowerCase();

  return number.includes(term) || supplier.includes(term);
}

export function listPurchases(searchParams: URLSearchParams, storeId: string) {
  const from = searchParams.get("from");
  const search = searchParams.get("search");
  const status = searchParams.get("status");
  const supplierId = searchParams.get("supplierId");
  const to = searchParams.get("to");

  const items = mockPurchases
    .filter((purchase) => {
      const supplier = mockContacts.find((contact) => contact.id === purchase.supplierId);

      return (
        (purchase.storeId ?? DEFAULT_STORE_ID) === storeId &&
        (!status || purchase.status === status) &&
        (!supplierId || purchase.supplierId === supplierId) &&
        isUtcTimestampInCaracasDateRange(purchase.createdAt, from, to) &&
        (!search || matchesPurchaseSearch(purchase, supplier?.name, search))
      );
    })
    .map((purchase) => ({
      ...purchase,
      itemsCount: mockPurchaseItems.filter((item) => item.purchaseId === purchase.id).length,
      supplier: mockContacts.find((contact) => contact.id === purchase.supplierId),
    }));

  return paginateList(items, searchParams);
}

/**
 * Compras creadas en esta ejecucion, con sus lineas ya resueltas (porcentaje y
 * `code` de la alicuota de IVA). Solo alimentan el detalle: no entran en los
 * listados ni en los agregados de la semilla (saldos, reportes, stock).
 */
const createdPurchases = new Map<string, { items: PurchaseItemMock[]; purchase: PurchaseMock }>();

/** Postgres escribe un `numeric(5,2)` con sus dos decimales ("13.00"). */
function formatPct(pct: number) {
  return pct.toFixed(2);
}

/**
 * IVA de una linea con las mismas reglas (y textos) que `create_purchase`:
 * - con `taxRateCode`: debe existir y estar activa en la tienda; el porcentaje
 *   es el de la alicuota y, si ademas llega `taxRate`, debe coincidir;
 * - solo `taxRate`: debe ser el porcentaje de una alicuota activa; se guarda su code.
 */
function resolveLineTaxRate(item: PurchaseItemInput, storeId: string) {
  const code = item.taxRateCode?.trim() || undefined;
  const pct = item.taxRate === undefined ? undefined : normalizeTaxRatePct(item.taxRate);

  if (code) {
    const rate = findActiveMockTaxRateByCode(storeId, code);

    if (!rate) {
      throw new ApiError(
        400,
        "BAD_REQUEST",
        `La alicuota de IVA "${code}" no existe o no esta activa en tu tienda`,
      );
    }

    if (pct !== undefined && pct !== rate.pct) {
      throw new ApiError(
        400,
        "BAD_REQUEST",
        `El porcentaje de IVA enviado (${formatPct(pct)} %) no coincide con la alicuota "${code}" (${formatPct(rate.pct)} %)`,
      );
    }

    return { taxRate: rate.pct, taxRateCode: rate.code };
  }

  if (pct === undefined) {
    throw new ApiError(
      400,
      "BAD_REQUEST",
      "Cada item debe enviar costos/subtotales/impuesto en REF y VES",
    );
  }

  const rate = findMockTaxRateForPct(storeId, pct, true);

  if (!rate) {
    throw new ApiError(
      400,
      "BAD_REQUEST",
      `El porcentaje de IVA ${formatPct(pct)} % no corresponde a ninguna alicuota activa`,
    );
  }

  return { taxRate: pct, taxRateCode: rate.code };
}

function toPurchaseItemMock(
  item: PurchaseItemInput,
  purchaseId: string,
  tax: { taxRate: number; taxRateCode: string },
): PurchaseItemMock {
  const line = normalizePurchaseLine(item);

  return {
    costCurrency: item.costCurrency,
    entryMode: line.entryMode,
    ...(item.entryMode === "pack"
      ? {
          packCostRef: item.packCostRef,
          packCostVes: item.packCostVes,
          packCount: item.packCount,
          packLabel: item.packLabel,
          unitsPerPack: item.unitsPerPack,
        }
      : {}),
    productId: item.productId,
    purchaseId,
    quantity: line.quantity,
    subtotalRef: item.subtotalRef,
    subtotalVes: item.subtotalVes,
    taxRate: tax.taxRate,
    taxRateCode: tax.taxRateCode,
    taxRef: item.taxRef,
    taxVes: item.taxVes,
    unitCostRef: item.unitCostRef,
    unitCostVes: item.unitCostVes,
  };
}

export function getPurchaseById(id: string, storeId: string) {
  const created = createdPurchases.get(id);
  const purchase = created?.purchase ?? mockPurchases.find((item) => item.id === id);
  assertMockStoreResource(purchase, storeId, "Compra no encontrada.");

  const items = (created?.items ?? mockPurchaseItems.filter((item) => item.purchaseId === id))
    .map((item) => ({
      ...item,
      product: mockProducts.find((product) => product.id === item.productId),
    }));

  return {
    ...purchase,
    items,
    payments: mockPayments
      .filter((payment) => payment.purchaseId === id)
      .map((payment) => ({
        ...payment,
        contact: mockContacts.find((contact) => contact.id === payment.contactId),
      })),
    supplier: mockContacts.find((contact) => contact.id === purchase.supplierId),
  };
}

/**
 * Compras ya creadas por clave de idempotencia (`storeId:clientRequestId`), como
 * hace `create_purchase` en la base: la misma clave devuelve la compra original.
 */
const purchasesByClientRequest = new Map<string, PurchaseMock>();

export function createPurchase(input: PurchaseInput, storeId: string) {
  const requestKey = input.clientRequestId ? `${storeId}:${input.clientRequestId}` : null;
  const previous = requestKey ? purchasesByClientRequest.get(requestKey) : undefined;

  if (previous) {
    return previous;
  }

  // Antes de crear nada: una linea con IVA invalido rechaza la compra entera.
  const lines = (input.items ?? []).map((item) => ({
    item,
    tax: resolveLineTaxRate(item, storeId),
  }));

  const refRateVes = input.refRateVes ?? 510;
  const subtotalRef = roundMoney(
    input.subtotalRef ??
      input.items?.reduce(
        (total, item) => total + normalizePurchaseLine(item).subtotalRef,
        0,
      ) ??
      0,
  );
  const discountRef = input.discountRef ?? 0;
  const taxRef = input.taxRef ?? 0;
  const totalRef = roundMoney(subtotalRef - discountRef + taxRef);
  const subtotalVes =
    input.subtotalVes ?? Math.round(subtotalRef * refRateVes * 100) / 100;
  const discountVes =
    input.discountVes ?? Math.round(discountRef * refRateVes * 100) / 100;
  const taxVes = input.taxVes ?? Math.round(taxRef * refRateVes * 100) / 100;

  const status = input.status ?? "recibido";

  const purchase = {
    createdAt: new Date().toISOString(),
    discountRef,
    discountVes,
    id: `purchase-mock-${Date.now()}-${createdPurchases.size + 1}`,
    paidRef: 0,
    paidVes: 0,
    purchaseNumber: input.purchaseNumber ?? `C-MOCK-${Date.now()}`,
    refRateVes,
    status,
    storeId,
    subtotalRef,
    subtotalVes,
    supplierId: input.supplierId ?? "cont-supplier",
    taxRef,
    taxVes,
    totalRef,
    totalVes: Math.round((subtotalVes - discountVes + taxVes) * 100) / 100,
    userId: "user-demo",
  } satisfies PurchaseMock;

  createdPurchases.set(purchase.id, {
    items: lines.map(({ item, tax }) => toPurchaseItemMock(item, purchase.id, tax)),
    purchase,
  });

  if (requestKey) {
    purchasesByClientRequest.set(requestKey, purchase);
  }

  return purchase;
}

export function receivePurchase(id: string, storeId: string) {
  const purchase = getPurchaseById(id, storeId);

  if (purchase.status !== "pedido") {
    throw new ApiError(400, "BAD_REQUEST", "Solo se pueden recibir compras en estado pedido.");
  }

  return {
    ...purchase,
    status: "recibido",
  };
}

export function cancelPurchase(id: string, storeId: string) {
  return {
    ...getPurchaseById(id, storeId),
    status: "cancelado",
  };
}

export function returnPurchase(id: string, storeId: string) {
  const purchase = getPurchaseById(id, storeId);

  return {
    purchase: {
      ...purchase,
      status: "devuelto",
    },
    stockMovements: purchase.items.map((item) => ({
      createdAt: new Date().toISOString(),
      id: `mov-purchase-return-${item.productId}-${Date.now()}`,
      productId: item.productId,
      purchaseId: purchase.id,
      quantityDelta: -item.quantity,
      reason: `Devolucion de compra ${purchase.purchaseNumber}`,
      storeId,
      type: "devolucion_proveedor",
    })),
  };
}
