import { ApiError } from "@/lib/api/apiError";
import { assertMockStoreResource } from "@/lib/api/assertStoreResource";
import { paginateList } from "@/lib/api/pagination";
import { findMockPurchase } from "@/modules/purchases/services/purchaseMockStore";
import { getPricingSettings } from "@/modules/settings/services/settings.mock-server";
import {
  mockContacts,
  mockProductPriceHistory,
  mockProducts,
  mockUserProfiles,
  type ProductMock,
  type ProductPriceHistoryMock,
} from "@/shared/mocks/erp-data";
import { mockState } from "@/shared/mocks/mockStore";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";
import { priceFromMarkup } from "@/shared/utils/pricing";

import { assertListFilterParams } from "./listFilterParams";
import {
  buildCostChangedMessage,
  buildPriceReview,
  buildRepriceReason,
  comparePriceReviewItems,
  COST_CHANGED_CODE,
  getPriceHistoryKind,
  getPriceSnapshotBand,
  isSameCostRef,
  normalizeRepriceMarkupPct,
  PRICE_BASELINE_REASON,
  PRICE_KEEP_REASON,
  REPRICE_NO_COST_MESSAGE,
  REPRICE_REQUEST_REUSED_MESSAGE,
  resolveRepriceTargets,
  summarizeReprice,
  type ProductPriceHistoryEntry,
  type ProductPriceReview,
  type ProductPriceReviewItem,
  type ProductPriceReviewPurchase,
  type RepriceProductResult,
} from "./priceReview";
import { getProductMarginThresholds } from "./productMargin";
import type { KeepProductPriceInput, RepriceProductsInput } from "./productSchemas";

/** Una compra recibida que fijó el costo de un producto (lo que en la base deja el movimiento `compra`). */
type MockCostEvent = {
  productId: string;
  purchaseId: string;
  receivedAt: string;
  seq: number;
};

/**
 * Posición en el libro compartida por instantáneas y compras recibidas, como
 * `stock_movements_seq` en la base: decide cuál es la última instantánea de un
 * producto y qué compras llegaron después de ella.
 */
function ledger() {
  return mockState("products:price-review", () => ({ costEvents: [] as MockCostEvent[], seq: 0 }));
}

function nextSeq() {
  const state = ledger();
  state.seq += 1;

  return state.seq;
}

function storeOf(product: ProductMock) {
  return product.storeId ?? DEFAULT_STORE_ID;
}

function thresholdsOf(storeId: string) {
  return getProductMarginThresholds(getPricingSettings(storeId));
}

/**
 * Inserta una fila de historial con la instantánea del momento: el costo vigente
 * y la banda que deja `salePriceRef`. Es lo que hacen `update_product_price`,
 * `keep_product_price` y la línea base. No cambia el producto.
 */
function recordPriceSnapshot(
  product: ProductMock,
  input: { previousSalePriceRef: number; reason: string | null; salePriceRef: number; userId: string },
) {
  const entry: ProductPriceHistoryMock = {
    costRefSnapshot: product.currentCostRef,
    createdAt: new Date().toISOString(),
    id: `price-mock-${Date.now()}-${mockProductPriceHistory.length}`,
    marginBandSnapshot: getPriceSnapshotBand(
      product.currentCostRef,
      input.salePriceRef,
      thresholdsOf(storeOf(product)),
    ),
    previousSalePriceRef: input.previousSalePriceRef,
    productId: product.id,
    reason: input.reason,
    salePriceRef: input.salePriceRef,
    snapshotSeq: nextSeq(),
    userId: input.userId,
  };

  mockProductPriceHistory.push(entry);

  return entry;
}

function latestSnapshot(productId: string) {
  let latest: ProductPriceHistoryMock | undefined;

  for (const entry of mockProductPriceHistory) {
    if (
      entry.productId === productId &&
      entry.snapshotSeq !== undefined &&
      (latest?.snapshotSeq ?? 0) < entry.snapshotSeq
    ) {
      latest = entry;
    }
  }

  return latest;
}

/**
 * Línea base de ganancia de los productos que aún no tienen instantánea: lo que
 * en la base hacen el backfill del parche 20261009c y el trigger de las altas.
 * Los servicios mock la llaman ANTES de leer o cambiar precios y costos, así la
 * línea base siempre guarda el costo previo al cambio.
 */
export function ensureMockPriceBaselines() {
  for (const product of mockProducts) {
    if (!latestSnapshot(product.id)) {
      recordPriceSnapshot(product, {
        previousSalePriceRef: product.salePriceRef,
        reason: PRICE_BASELINE_REASON,
        salePriceRef: product.salePriceRef,
        userId: "",
      });
    }
  }
}

export function toMockPriceHistoryEntry(entry: ProductPriceHistoryMock): ProductPriceHistoryEntry {
  const previousSalePriceRef = entry.previousSalePriceRef ?? null;
  const reason = entry.reason?.trim() || null;

  return {
    createdAt: entry.createdAt,
    id: entry.id,
    kind: getPriceHistoryKind(previousSalePriceRef, entry.salePriceRef, reason),
    previousSalePriceRef,
    productId: entry.productId,
    reason,
    salePriceRef: entry.salePriceRef,
    userId: entry.userId,
    userName: mockUserProfiles.find((profile) => profile.id === entry.userId)?.name ?? null,
  };
}

/**
 * Fila de historial de un cambio de precio, como la que inserta
 * `update_product_price`. Hay que llamarla ANTES de escribir el precio nuevo en
 * el producto: el precio anterior se lee de él.
 */
export function recordMockPriceChange(
  product: ProductMock,
  input: { reason: string | null; salePriceRef: number },
) {
  ensureMockPriceBaselines();

  return toMockPriceHistoryEntry(
    recordPriceSnapshot(product, {
      previousSalePriceRef: product.salePriceRef,
      reason: input.reason,
      salePriceRef: input.salePriceRef,
      userId: "user-demo",
    }),
  );
}

function causingPurchase(productId: string, afterSeq: number): ProductPriceReviewPurchase | undefined {
  let latest: MockCostEvent | undefined;

  for (const event of ledger().costEvents) {
    if (event.productId === productId && event.seq > afterSeq && (latest?.seq ?? 0) < event.seq) {
      latest = event;
    }
  }

  if (!latest) {
    return undefined;
  }

  // Semilla o creada en el mock: las creadas no están en `mockPurchases`.
  const purchase = findMockPurchase(latest.purchaseId);
  const supplierName = mockContacts.find((contact) => contact.id === purchase?.supplierId)?.name;

  return {
    id: latest.purchaseId,
    number: purchase?.purchaseNumber ?? "",
    receivedAt: latest.receivedAt,
    ...(supplierName ? { supplierName } : {}),
  };
}

/** `priceReview` de un producto, o `null` si no está en la cola (misma regla que la vista). */
function reviewOf(product: ProductMock): ProductPriceReview | null {
  const snapshot = latestSnapshot(product.id);

  if (
    !product.isActive ||
    !snapshot ||
    snapshot.costRefSnapshot === undefined ||
    snapshot.marginBandSnapshot === undefined ||
    snapshot.snapshotSeq === undefined
  ) {
    return null;
  }

  return buildPriceReview({
    currentCostRef: product.currentCostRef,
    purchase: causingPurchase(product.id, snapshot.snapshotSeq),
    salePriceRef: product.salePriceRef,
    snapshot: {
      at: snapshot.createdAt,
      band: snapshot.marginBandSnapshot,
      costRef: snapshot.costRefSnapshot,
    },
    thresholds: thresholdsOf(storeOf(product)),
  });
}

/**
 * Añade `priceReview` a los productos que están en la cola (y solo a esos),
 * como la relación `price_review` del listado y del detalle reales.
 */
export function attachMockPriceReview<TProduct extends ProductMock>(
  products: TProduct[],
): (TProduct & { priceReview?: ProductPriceReview })[] {
  ensureMockPriceBaselines();

  return products.map((product) => {
    const priceReview = reviewOf(product);

    return priceReview ? { ...product, priceReview } : product;
  });
}

function listStoreReviewItems(storeId: string): ProductPriceReviewItem[] {
  ensureMockPriceBaselines();

  return mockProducts
    .filter((product) => storeOf(product) === storeId)
    .flatMap((product) => {
      const review = reviewOf(product);

      return review
        ? [
            {
              ...review,
              name: product.name,
              productId: product.id,
              salePriceRef: product.salePriceRef,
              sku: product.sku,
            },
          ]
        : [];
    })
    .sort(comparePriceReviewItems);
}

export function listPriceReview(searchParams: URLSearchParams, storeId: string) {
  assertListFilterParams(searchParams, ["purchaseId"]);

  const purchaseId = searchParams.get("purchaseId")?.trim();
  const items = listStoreReviewItems(storeId).filter(
    (item) => !purchaseId || item.purchase?.id === purchaseId,
  );

  return paginateList(items, searchParams);
}

export function getPriceReviewSummary(storeId: string) {
  return { total: listStoreReviewItems(storeId).length };
}

/**
 * Como `assert_expected_cost_ref` en la base: con el costo que vio el usuario,
 * 409 si el producto ya cuesta otra cosa (a dos decimales). Sin él no comprueba nada.
 */
export function assertMockExpectedCost(
  id: string,
  expectedCostRef: number | null | undefined,
  storeId: string,
) {
  const product = mockProducts.find((item) => item.id === id);
  assertMockStoreResource(product, storeId, "Producto no encontrado.");

  if (
    expectedCostRef !== null &&
    expectedCostRef !== undefined &&
    !isSameCostRef(expectedCostRef, product.currentCostRef)
  ) {
    throw new ApiError(
      409,
      "CONFLICT",
      buildCostChangedMessage(expectedCostRef, product.currentCostRef),
    );
  }
}

/** Como la RPC `keep_product_price`: nueva instantánea con el mismo precio; el producto no cambia. */
export function keepProductPrice(id: string, input: KeepProductPriceInput, storeId: string) {
  const product = mockProducts.find((item) => item.id === id);
  assertMockStoreResource(product, storeId, "Producto no encontrado.");
  assertMockExpectedCost(id, input.expectedCostRef, storeId);
  ensureMockPriceBaselines();

  return toMockPriceHistoryEntry(
    recordPriceSnapshot(product, {
      previousSalePriceRef: product.salePriceRef,
      reason: input.reason ?? PRICE_KEEP_REASON,
      salePriceRef: product.salePriceRef,
      userId: "user-demo",
    }),
  );
}

/**
 * Reprecios ya aplicados con clave: `tienda:clave:producto` → % enviado. Es lo que
 * en la base guardan `product_price_history.client_request_id` / `client_request_hash`.
 */
function repriceRequests() {
  return mockState("products:reprice-requests", () => new Map<string, number>());
}

/**
 * Como el servicio real: un cambio de precio por producto y un resultado por
 * producto. Igual que `reprice_product_to_markup` (parche 20261017a): la misma
 * `clientRequestId` no repite el cambio de un producto, y un reprecio que deja el
 * mismo precio sobre una instantánea que ya guarda el costo y la banda vigentes
 * no inserta historial.
 */
export function repriceProducts(input: RepriceProductsInput, storeId: string) {
  const reason = input.reason ?? buildRepriceReason(input.markupPct);
  const markupPct = normalizeRepriceMarkupPct(input.markupPct);
  const requests = repriceRequests();
  const results: RepriceProductResult[] = [];

  for (const { expectedCostRef, productId } of resolveRepriceTargets(input)) {
    const product = mockProducts.find((item) => item.id === productId && storeOf(item) === storeId);

    if (!product) {
      results.push({ code: "NOT_FOUND", message: "Producto no encontrado.", productId, status: "error" });
      continue;
    }

    const requestKey = input.clientRequestId ? `${storeId}:${input.clientRequestId}:${productId}` : null;
    const priorMarkupPct = requestKey ? requests.get(requestKey) : undefined;

    // Reintento de una petición que ya cambió este producto: no se repite.
    if (priorMarkupPct !== undefined) {
      results.push(
        priorMarkupPct === markupPct
          ? { productId, salePriceRef: product.salePriceRef, status: "ok" }
          : { code: "CONFLICT", message: REPRICE_REQUEST_REUSED_MESSAGE, productId, status: "error" },
      );
      continue;
    }

    if (!(product.currentCostRef > 0)) {
      results.push({ code: "NO_COST", message: REPRICE_NO_COST_MESSAGE, productId, status: "error" });
      continue;
    }

    // Como `reprice_product_to_markup`: el costo que vio el usuario ya no vale.
    if (expectedCostRef !== null && !isSameCostRef(expectedCostRef, product.currentCostRef)) {
      results.push({
        code: COST_CHANGED_CODE,
        message: buildCostChangedMessage(expectedCostRef, product.currentCostRef),
        productId,
        status: "error",
      });
      continue;
    }

    const salePriceRef = priceFromMarkup(product.currentCostRef, markupPct);

    ensureMockPriceBaselines();
    const last = latestSnapshot(product.id);
    // La fila nueva sería idéntica a la última instantánea: no se escribe.
    const nothingToRecord =
      salePriceRef === product.salePriceRef &&
      last?.salePriceRef === salePriceRef &&
      last.costRefSnapshot === product.currentCostRef &&
      last.marginBandSnapshot ===
        getPriceSnapshotBand(product.currentCostRef, salePriceRef, thresholdsOf(storeId));

    if (!nothingToRecord) {
      recordMockPriceChange(product, { reason, salePriceRef });
      product.salePriceRef = salePriceRef;

      if (requestKey) {
        requests.set(requestKey, markupPct);
      }
    }

    results.push({ productId, salePriceRef, status: "ok" });
  }

  return summarizeReprice(results);
}

/**
 * Fixture de tests e historias: sube (o baja) el costo de un producto como lo
 * haría recibir una compra en la base (`receive_purchase` / `create_purchase`
 * escriben `current_cost_ref` y dejan el movimiento `compra`). El mock de
 * compras NO actualiza el costo al recibir, por eso la cola del mock no se
 * entera sola de una recepción. Con `purchaseId` esa compra queda como la
 * causante. No toca `currentStock`.
 */
export function applyMockPurchaseCost(productId: string, costRef: number, purchaseId?: string) {
  const product = mockProducts.find((item) => item.id === productId);

  if (!product) {
    throw new Error(`Producto mock no encontrado: ${productId}`);
  }

  ensureMockPriceBaselines();
  product.currentCostRef = costRef;

  if (purchaseId) {
    recordMockPurchaseCostEvent(productId, purchaseId);
  }

  return product;
}

/**
 * Deja a `purchaseId` como la compra que fijó el costo de `productId`, sin tocar
 * el costo: lo que en la base hace el movimiento `compra` o, para el componente de
 * un empaque desarmado al recibir, la `conversion_entrada` de la apertura que la
 * línea de compra guarda en `disassembled_conversion_id` (20261012b). Quien la
 * llame debe haber asegurado antes la línea base (`ensureMockPriceBaselines`),
 * con el costo previo al cambio.
 */
export function recordMockPurchaseCostEvent(productId: string, purchaseId: string) {
  ledger().costEvents.push({
    productId,
    purchaseId,
    receivedAt: new Date().toISOString(),
    seq: nextSeq(),
  });
}
