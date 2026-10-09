import { ApiError } from "@/lib/api/apiError";
import { assertMockStoreResource } from "@/lib/api/assertStoreResource";
import { paginateList, type PaginatedList } from "@/lib/api/pagination";
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
import {
  convertPackToUnits,
  createStockAdjustment,
} from "@/modules/inventory/services/inventory.mock-server";
import {
  assertPackDistribution,
  type PackDistributionItem,
} from "@/modules/products/services/packConversionSchemas";
import {
  applyMockPurchaseCost,
  ensureMockPriceBaselines,
  recordMockPurchaseCostEvent,
} from "@/modules/products/services/priceReview.mock-server";
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

import { getPurchasePendingRef, hasPendingBalance } from "../purchases-list/utils/purchaseBalance";
import type { PurchaseItemInput } from "../schemas/purchaseItem.schema";
import { normalizePurchaseLine } from "../schemas/purchaseItem.schema";
import {
  missingRecipeOnCreateMessage,
  missingRecipeOnReceiveMessage,
  type PurchaseLineRecipe,
  type ReceivePurchaseOptions,
} from "./purchaseDisassemble";
import { createdMockPurchases, findMockPurchase } from "./purchaseMockStore";

export { findMockPurchase };

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

/**
 * Lo pagado de una compra del mock: la suma de sus pagos activos, con la regla
 * de `purchases.server` (`amountRef` del pago o, si falta, sus Bs a su tasa).
 * La cabecera de la semilla no trae `paidRef`; en la base la mantiene
 * `register_payment` y coincide con esta suma, así que aquí vale igual con o
 * sin permiso para ver los pagos.
 */
function mockPaidTotals(purchaseId: string) {
  const activePayments = mockPayments.filter(
    (payment) => payment.purchaseId === purchaseId && payment.status !== "anulado",
  );

  return {
    paidRef: roundMoney(
      activePayments.reduce((sum, payment) => {
        if (payment.amountRef > 0) {
          return sum + payment.amountRef;
        }

        if (payment.refRateVes > 0 && payment.amountVes > 0) {
          return sum + payment.amountVes / payment.refRateVes;
        }

        return sum;
      }, 0),
    ),
    paidVes: roundMoney(activePayments.reduce((sum, payment) => sum + payment.amountVes, 0)),
  };
}

/**
 * Mismos filtros que `purchases.server`: `search`, `status`, `supplierId`,
 * `from` / `to` (día operativo Caracas) y `pendingBalance=1` (solo compras
 * vigentes con saldo; añade `pendingBalanceRef`, la suma del saldo del filtro).
 */
export function listPurchases(searchParams: URLSearchParams, storeId: string) {
  const from = searchParams.get("from");
  const onlyPendingBalance = searchParams.get("pendingBalance") === "1";
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
      ...mockPaidTotals(purchase.id),
      itemsCount: mockPurchaseItems.filter((item) => item.purchaseId === purchase.id).length,
      supplier: mockContacts.find((contact) => contact.id === purchase.supplierId),
    }))
    .filter((purchase) => !onlyPendingBalance || hasPendingBalance(purchase));

  const page: PaginatedList<(typeof items)[number]> & { pendingBalanceRef?: number } =
    paginateList(items, searchParams);

  if (onlyPendingBalance) {
    page.pendingBalanceRef = roundMoney(
      items.reduce((sum, purchase) => sum + getPurchasePendingRef(purchase), 0),
    );
  }

  return page;
}

/**
 * Compras creadas en esta ejecucion, con sus lineas ya resueltas (porcentaje y
 * `code` de la alicuota de IVA). Solo alimentan el detalle: no entran en los
 * listados ni en los agregados de la semilla (saldos, reportes, stock).
 *
 * Ancladas a `globalThis` (`mockState`): `next dev` vuelve a evaluar este modulo
 * al compilar otra ruta y un `Map` de modulo se vaciaria entre el POST y el GET.
 */
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
 * COM-14 · estado del desarme por línea (`purchaseItemId`): la marca «Desarmar al
 * recibir» y la apertura que hizo la recepción. Vive aparte de las líneas porque
 * las de la semilla son compartidas; sin entrada, la línea no está marcada.
 */
function disassembleState() {
  return mockState(
    "purchases:disassemble",
    () => new Map<string, { conversionId?: string; marked: boolean }>(),
  );
}

/** Id de una línea en el mock: su compra y su posición (las líneas no cambian de orden). */
function purchaseItemId(purchaseId: string, index: number) {
  return `${purchaseId}:item-${index}`;
}

/** Receta ACTIVA de la que el producto es el empaque, como la mira `create_purchase`. */
function findActiveRecipe(productId: string, storeId: string) {
  return mockProductPackConversions.find(
    (conversion) =>
      conversion.isActive &&
      conversion.storeId === storeId &&
      conversion.packProductId === productId,
  );
}

function toLineRecipe(recipe: NonNullable<ReturnType<typeof findActiveRecipe>>): PurchaseLineRecipe {
  return {
    components: recipe.components
      .map((component) => {
        const product = mockProducts.find((item) => item.id === component.unitProductId);

        return {
          currentStock: product?.currentStock ?? 0,
          isActive: product?.isActive !== false,
          name: product?.name ?? component.unitProductId,
          unitProductId: component.unitProductId,
          unitsPerPack: component.unitsPerPack,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "es") || (a.unitProductId < b.unitProductId ? -1 : 1)),
    conversionId: recipe.id,
    totalUnits: recipe.totalUnits,
  };
}

/** Nombres (por orden alfabético) de los productos de esas líneas sin receta activa. */
function productsWithoutRecipe(productIds: readonly string[], storeId: string) {
  return mockProducts
    .filter(
      (product) =>
        productIds.includes(product.id) &&
        (product.storeId ?? DEFAULT_STORE_ID) === storeId &&
        !findActiveRecipe(product.id, storeId),
    )
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1))
    .map((product) => product.name);
}

type DisassembleLine = {
  distribution?: PackDistributionItem[];
  item: PurchaseItemMock;
  itemId: string;
};

/**
 * Todo lo que puede fallar al abrir, ANTES de mover nada (la base lo revierte
 * todo; el mock no tiene transacción): el reparto enviado debe ser de la receta
 * y sumar las unidades de los empaques de la línea.
 */
function assertDisassembleDistributions(lines: readonly DisassembleLine[], storeId: string) {
  for (const line of lines) {
    const recipe = findActiveRecipe(line.item.productId, storeId);

    if (recipe && line.distribution) {
      assertPackDistribution(
        {
          componentIds: recipe.components.map((component) => component.unitProductId),
          totalUnits: recipe.totalUnits,
        },
        line.item.quantity,
        line.distribution,
      );
    }
  }
}

/**
 * Abre los empaques de las líneas marcadas de una compra recién recibida, con
 * las funciones de movimiento del mock de inventario (nunca escribiendo el stock
 * a mano): entran los empaques de la línea (`compra`) y `convertPackToUnits` los
 * abre con su receta o con el reparto enviado. La clave de la apertura es la de
 * la línea: no se abre dos veces.
 */
function disassembleReceivedLines(
  purchase: PurchaseMock,
  lines: readonly DisassembleLine[],
  storeId: string,
) {
  for (const line of lines) {
    createStockAdjustment(
      {
        clientRequestId: `purchase-receive:${line.itemId}`,
        productId: line.item.productId,
        quantityDelta: line.item.quantity,
        reason: `Recepcion ${purchase.purchaseNumber}`,
        type: "compra",
      },
      storeId,
    );

    // La línea base de ganancia guarda el costo de los componentes ANTES de la apertura.
    ensureMockPriceBaselines();

    const conversion = convertPackToUnits(
      {
        clientRequestId: `purchase-disassemble:${line.itemId}`,
        ...(line.distribution ? { components: line.distribution } : {}),
        packProductId: line.item.productId,
        packQuantity: line.item.quantity,
        reason: `Desarme al recibir ${purchase.purchaseNumber}`,
      },
      storeId,
    );

    disassembleState().set(line.itemId, { conversionId: conversion.conversionId, marked: true });

    // INT-04: el costo que la apertura fija en cada componente es de ESTA compra, como
    // en la base (products_price_review enlaza la conversión con la línea desarmada).
    for (const component of conversion.components) {
      recordMockPurchaseCostEvent(component.unitProductId, purchase.id);
    }
  }
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
 * individuales: `payments: []`. `paidRef` / `paidVes` son los mismos con o sin
 * permiso: la suma de los pagos activos de la compra (`mockPaidTotals`).
 */
export function getPurchaseById(
  id: string,
  storeId: string,
  access: PurchaseDetailAccess = { canViewPayments: true },
) {
  const created = createdMockPurchases().get(id);
  const purchase = created?.purchase ?? mockPurchases.find((item) => item.id === id);
  assertMockStoreResource(purchase, storeId, "Compra no encontrada.");

  // COM-14: cada línea lleva su id, la marca «Desarmar al recibir», si ya se desarmó
  // y, en un pedido, la receta activa de su producto (para previsualizar la recepción).
  const items = (created?.items ?? mockPurchaseItems.filter((item) => item.purchaseId === id))
    .map((item, index) => {
      const itemId = purchaseItemId(id, index);
      const disassemble = disassembleState().get(itemId);
      const recipe = purchase.status === "pedido" ? findActiveRecipe(item.productId, storeId) : undefined;

      return {
        ...item,
        disassembled: Boolean(disassemble?.conversionId),
        disassembleOnReceive: disassemble?.marked === true,
        id: itemId,
        ...(recipe ? { packRecipe: toLineRecipe(recipe) } : {}),
        product: mockProducts.find((product) => product.id === item.productId),
      };
    });

  return {
    ...purchase,
    ...mockPaidTotals(id),
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

  // COM-14 · una línea marcada exige receta activa de su producto, en un pedido y
  // en una compra recibida (regla y texto de `create_purchase`).
  const withoutRecipe = productsWithoutRecipe(
    (input.items ?? []).filter((item) => item.disassembleOnReceive === true).map((item) => item.productId),
    storeId,
  );

  if (withoutRecipe.length > 0) {
    throw new ApiError(400, "BAD_REQUEST", missingRecipeOnCreateMessage(withoutRecipe));
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

  createdMockPurchases().set(purchase.id, { items, purchase });

  const marked: DisassembleLine[] = items.flatMap((item, index) =>
    lines[index]?.item.disassembleOnReceive === true
      ? [{ item, itemId: purchaseItemId(purchase.id, index) }]
      : [],
  );

  for (const line of marked) {
    disassembleState().set(line.itemId, { marked: true });
  }

  if (status === "recibido") {
    applyReceivedCosts(purchase.id, items, storeId);
    // Con el costo del empaque ya fijado por la recepción, como en la base.
    disassembleReceivedLines(purchase, marked, storeId);
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

/** Recepciones ya hechas con clave de idempotencia (`storeId:purchaseId`). */
function receiptsByClientRequest() {
  return mockState(
    "purchases:receiveByClientRequest",
    () => new Map<string, { clientRequestId: string; fingerprint: string }>(),
  );
}

/**
 * Como `receive_purchase_and_disassemble` (COM-14): recibe el pedido y abre los
 * empaques de las líneas marcadas. `options.disassemble` sustituye las marcas del
 * pedido; la misma `clientRequestId` con el mismo contenido devuelve la compra ya
 * recibida. Todo se valida antes de mover nada.
 */
export function receivePurchase(id: string, storeId: string, options: ReceivePurchaseOptions = {}) {
  const purchase = getPurchaseById(id, storeId);
  const receiptKey = `${storeId}:${id}`;
  const fingerprint = JSON.stringify(options.disassemble ?? null);
  const previous = receiptsByClientRequest().get(receiptKey);

  if (options.clientRequestId && previous?.clientRequestId === options.clientRequestId) {
    if (previous.fingerprint !== fingerprint || purchase.status !== "recibido") {
      throw new ApiError(
        409,
        "CONFLICT",
        "La clave de idempotencia ya se uso en otra recepcion de esta compra. Revisa la compra antes de reintentar.",
      );
    }

    return purchase;
  }

  if (purchase.status !== "pedido") {
    throw new ApiError(400, "BAD_REQUEST", "Solo se pueden recibir compras en estado pedido.");
  }

  const requested = options.disassemble;

  if (requested) {
    const itemIds = purchase.items.map((item) => item.id);

    if (new Set(requested.map((entry) => entry.purchaseItemId)).size !== requested.length) {
      throw new ApiError(400, "BAD_REQUEST", "La lista de lineas a desarmar repite una linea");
    }

    if (requested.some((entry) => !itemIds.includes(entry.purchaseItemId))) {
      throw new ApiError(400, "BAD_REQUEST", "Una linea a desarmar no pertenece a la compra");
    }
  }

  // La lista manda sobre la marca guardada con el pedido.
  const marked: DisassembleLine[] = purchase.items.flatMap((item) => {
    const entry = requested?.find((candidate) => candidate.purchaseItemId === item.id);

    return (requested ? entry !== undefined : item.disassembleOnReceive)
      ? [{ distribution: entry?.distribution, item, itemId: item.id }]
      : [];
  });
  const withoutRecipe = productsWithoutRecipe(
    marked.map((line) => line.item.productId),
    storeId,
  );

  if (withoutRecipe.length > 0) {
    throw new ApiError(409, "CONFLICT", missingRecipeOnReceiveMessage(withoutRecipe));
  }

  assertDisassembleDistributions(marked, storeId);

  for (const item of purchase.items) {
    const isMarked = marked.some((line) => line.itemId === item.id);

    if (isMarked || disassembleState().has(item.id)) {
      disassembleState().set(item.id, { marked: isMarked });
    }
  }

  applyReceivedCosts(purchase.id, purchase.items, storeId);
  disassembleReceivedLines(purchase, marked, storeId);

  // Como `receive_purchase`: la compra queda recibida y no se puede volver a recibir.
  const stored = findMockPurchase(id);

  if (stored) {
    stored.status = "recibido";
  }

  if (options.clientRequestId) {
    receiptsByClientRequest().set(receiptKey, {
      clientRequestId: options.clientRequestId,
      fingerprint,
    });
  }

  return getPurchaseById(id, storeId);
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
