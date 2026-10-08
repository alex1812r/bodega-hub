import { ApiError } from "@/lib/api/apiError";
import { assertMockStoreResource } from "@/lib/api/assertStoreResource";
import { paginateList } from "@/lib/api/pagination";
import {
  mockContacts,
  mockPayments,
  mockProductPackConversions,
  mockProducts,
  mockPurchaseItems,
  mockPurchases,
  type PurchaseItemMock,
  type PurchaseMock,
} from "@/shared/mocks/erp-data";
import {
  linkPurchaseLines,
  type PurchaseLinkLine,
} from "@/modules/contacts/services/supplierProducts.mock-server";
import { applyMockPurchaseCost } from "@/modules/products/services/priceReview.mock-server";
import {
  findActiveMockTaxRateByCode,
  findMockTaxRateForPct,
} from "@/modules/settings/services/taxRates.mock-server";
import { normalizeTaxRatePct } from "@/modules/settings/services/taxRates.schemas";
import { isSupplierContactType } from "@/shared/auth/contactAccess";
import { mockState } from "@/shared/mocks/mockStore";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";
import { isUtcTimestampInCaracasDateRange } from "@/shared/utils/caracasBusinessDay";
import { amountWithTax, roundMoney } from "@/shared/utils/currency";

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
 *
 * Ancladas a `globalThis` (`mockState`): `next dev` vuelve a evaluar este modulo
 * al compilar otra ruta y un `Map` de modulo se vaciaria entre el POST y el GET.
 */
function createdPurchases() {
  return mockState(
    "purchases:created",
    () => new Map<string, { items: PurchaseItemMock[]; purchase: PurchaseMock }>(),
  );
}

/** Secuencia del id: no depende del tamano del registro ni de la evaluacion del modulo. */
function nextPurchaseSequence() {
  const sequence = mockState("purchases:idSequence", () => ({ last: 0 }));

  sequence.last += 1;

  return sequence.last;
}

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

/**
 * La compra tal como la guarda el mock, sea de la semilla o creada en esta
 * ejecucion. Sin control de tienda: quien la expone lo hace con `getPurchaseById`.
 */
export function findMockPurchase(id: string): PurchaseMock | undefined {
  return createdPurchases().get(id)?.purchase ?? mockPurchases.find((item) => item.id === id);
}

/**
 * Lo que el detalle de una compra puede enseñar a quien lo pide. La ruta lo
 * calcula con el rol de la sesión (`canViewPurchasePayments`).
 */
export type PurchaseDetailAccess = {
  /** `false`: sin pagos individuales; Pagado sale de la cabecera de la compra. */
  canViewPayments: boolean;
};

/**
 * Sin permiso para ver pagos de compras (almacén) el detalle no lleva los pagos
 * individuales: `payments: []`. `paidRef` / `paidVes` son siempre los de la
 * cabecera de la compra, que mantiene `createPayment`.
 */
export function getPurchaseById(
  id: string,
  storeId: string,
  access: PurchaseDetailAccess = { canViewPayments: true },
) {
  const created = createdPurchases().get(id);
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
    payments: access.canViewPayments
      ? mockPayments
          .filter((payment) => payment.purchaseId === id)
          .map((payment) => ({
            ...payment,
            contact: mockContacts.find((contact) => contact.id === payment.contactId),
          }))
      : [],
    supplier: mockContacts.find((contact) => contact.id === purchase.supplierId),
  };
}

/**
 * Costo que una linea recibida fija en su producto, con la regla de
 * `create_purchase` / `receive_purchase`: el ULTIMO costo (no un promedio), por
 * unidad y con el IVA de la linea, `round(unit_cost_ref * (1 + tax_rate / 100), 2)`.
 * Si el producto es el EMPAQUE de un par empaque -> unidad activo y la linea
 * llega por empaque, su unidad es el empaque: el costo es el del empaque.
 */
function receivedLineCostRef(item: PurchaseItemMock, storeId: string) {
  const netCostRef = isPackProductLine(item, storeId)
    ? (item.packCostRef ?? item.unitCostRef)
    : item.unitCostRef;

  return amountWithTax(roundMoney(netCostRef), item.taxRate ?? 0);
}

/** Línea por empaque sobre el producto EMPAQUE de un par activo: su unidad es el empaque. */
function isPackProductLine(item: PurchaseItemMock, storeId: string) {
  return (
    item.entryMode === "pack" &&
    mockProductPackConversions.some(
      (conversion) =>
        conversion.isActive &&
        conversion.storeId === storeId &&
        conversion.packProductId === item.productId,
    )
  );
}

/**
 * COM-02 · el proveedor de la compra con las reglas (y textos) de `create_purchase`:
 * existe, está activo y es proveedor / ambos. Se comprueba antes de crear nada.
 */
function assertPurchaseSupplier(supplierId: string) {
  const supplier = mockContacts.find((contact) => contact.id === supplierId);

  if (!supplier) {
    throw new ApiError(400, "BAD_REQUEST", "Proveedor no encontrado");
  }

  if (!supplier.isActive) {
    throw new ApiError(
      400,
      "BAD_REQUEST",
      `El proveedor ${supplier.name} está inactivo: no se puede registrar la compra`,
    );
  }

  if (!isSupplierContactType(supplier.type)) {
    throw new ApiError(
      400,
      "BAD_REQUEST",
      `El contacto ${supplier.name} no es proveedor: no se puede registrar la compra`,
    );
  }
}

/**
 * COM-15 · ninguna línea puede ser de un producto inactivo de la tienda, ni en una
 * compra recibida ni en un pedido, con la regla (y el texto) de `create_purchase`
 * (parche 20261010b). Se comprueba antes de crear nada. `receivePurchase` no lo
 * mira: un pedido hecho con el producto activo se recibe aunque se desactive después.
 */
function assertPurchaseProductsActive(items: readonly PurchaseItemInput[], storeId: string) {
  const productIds = new Set(items.map((item) => item.productId));
  const names = mockProducts
    .filter(
      (product) =>
        productIds.has(product.id) &&
        (product.storeId ?? DEFAULT_STORE_ID) === storeId &&
        !product.isActive,
    )
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1))
    .map((product) => product.name);

  if (names.length === 1) {
    throw new ApiError(
      400,
      "BAD_REQUEST",
      `El producto ${names[0]} está inactivo: no se puede registrar la compra`,
    );
  }

  if (names.length > 1) {
    throw new ApiError(
      400,
      "BAD_REQUEST",
      `Los productos ${names.join(", ")} están inactivos: no se puede registrar la compra`,
    );
  }
}

/**
 * COM-02 · cada línea de la compra queda vinculada al proveedor, como en
 * `create_purchase`: costo por unidad con el IVA de la línea y, si la línea se
 * guarda por empaque, su empaque (la línea sobre un producto EMPAQUE se guarda
 * por unidad: sin empaque del proveedor).
 */
function linkPurchasedProducts(
  purchase: PurchaseMock,
  entries: { item: PurchaseItemMock; supplierSku?: string }[],
  storeId: string,
) {
  const lines = entries
    .filter(({ item }) => {
      const product = mockProducts.find((candidate) => candidate.id === item.productId);

      return product !== undefined && (product.storeId ?? DEFAULT_STORE_ID) === storeId;
    })
    .map(({ item, supplierSku }): PurchaseLinkLine => {
      const onPackProduct = isPackProductLine(item, storeId);
      const netCostVes = onPackProduct ? (item.packCostVes ?? item.unitCostVes) : item.unitCostVes;
      const isPackLine = item.entryMode === "pack" && !onPackProduct;

      return {
        costRef: receivedLineCostRef(item, storeId),
        costVes: amountWithTax(roundMoney(netCostVes), item.taxRate ?? 0),
        pack:
          isPackLine && item.packLabel && item.unitsPerPack
            ? { label: item.packLabel, unitsPerPack: item.unitsPerPack }
            : undefined,
        productId: item.productId,
        supplierSku,
      };
    });

  linkPurchaseLines(
    lines,
    {
      purchaseNumber: purchase.purchaseNumber,
      received: purchase.status === "recibido",
      supplierId: purchase.supplierId,
    },
    storeId,
  );
}

/**
 * Lo que la recepcion hace con `products.current_cost_ref`, linea a linea (si un
 * producto se repite manda la ultima). Solo el costo: el mock sigue sin tocar
 * `currentStock` ni crear movimientos. La compra queda como causante en la cola
 * "Por revisar" (`price-review?purchaseId=`).
 */
function applyReceivedCosts(purchaseId: string, items: PurchaseItemMock[], storeId: string) {
  for (const item of items) {
    const product = mockProducts.find((candidate) => candidate.id === item.productId);

    if (product && (product.storeId ?? DEFAULT_STORE_ID) === storeId) {
      applyMockPurchaseCost(item.productId, receivedLineCostRef(item, storeId), purchaseId);
    }
  }
}

/**
 * Compras ya creadas por clave de idempotencia (`storeId:clientRequestId`), como
 * hace `create_purchase` en la base: la misma clave devuelve la compra original.
 */
function purchasesByClientRequest() {
  return mockState("purchases:byClientRequest", () => new Map<string, PurchaseMock>());
}

export function createPurchase(input: PurchaseInput, storeId: string) {
  const requestKey = input.clientRequestId ? `${storeId}:${input.clientRequestId}` : null;
  const previous = requestKey ? purchasesByClientRequest().get(requestKey) : undefined;

  if (previous) {
    return previous;
  }

  const supplierId = input.supplierId ?? "cont-supplier";

  assertPurchaseSupplier(supplierId);
  assertPurchaseProductsActive(input.items ?? [], storeId);

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
    id: `purchase-mock-${Date.now()}-${nextPurchaseSequence()}`,
    paidRef: 0,
    paidVes: 0,
    purchaseNumber: input.purchaseNumber ?? `C-MOCK-${Date.now()}`,
    refRateVes,
    status,
    storeId,
    subtotalRef,
    subtotalVes,
    supplierId,
    taxRef,
    taxVes,
    totalRef,
    totalVes: Math.round((subtotalVes - discountVes + taxVes) * 100) / 100,
    userId: "user-demo",
  } satisfies PurchaseMock;

  const items = lines.map(({ item, tax }) => toPurchaseItemMock(item, purchase.id, tax));

  createdPurchases().set(purchase.id, { items, purchase });

  if (status === "recibido") {
    applyReceivedCosts(purchase.id, items, storeId);
  }

  linkPurchasedProducts(
    purchase,
    items.map((item, index) => ({ item, supplierSku: lines[index]?.item.supplierSku })),
    storeId,
  );

  if (requestKey) {
    purchasesByClientRequest().set(requestKey, purchase);
  }

  return purchase;
}

export function receivePurchase(id: string, storeId: string) {
  const purchase = getPurchaseById(id, storeId);

  if (purchase.status !== "pedido") {
    throw new ApiError(400, "BAD_REQUEST", "Solo se pueden recibir compras en estado pedido.");
  }

  applyReceivedCosts(purchase.id, purchase.items, storeId);

  // Como `receive_purchase`: la compra queda recibida y no se puede volver a recibir.
  const stored = findMockPurchase(id);

  if (stored) {
    stored.status = "recibido";
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
