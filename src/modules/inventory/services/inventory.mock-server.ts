import { ApiError } from "@/lib/api/apiError";
import { assertMockStoreResource } from "@/lib/api/assertStoreResource";
import { paginateList } from "@/lib/api/pagination";
import {
  mockCategories,
  mockProductPackConversions,
  mockProducts,
  mockPurchaseItems,
  mockPurchases,
  mockSaleItems,
  mockSales,
  mockStockMovements,
  type ProductMock,
  type StockMovementMock,
  type StockMovementType,
} from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import {
  assertPackDistribution,
  type PackDistributionItem,
} from "@/modules/products/services/packConversionSchemas";
import { assertListFilterParams } from "@/modules/products/services/listFilterParams";
import { listPackConversions } from "@/modules/products/services/products.mock-server";
import {
  matchesInventoryListFilters,
  parseInventoryListFilters,
} from "../utils/inventoryListFilters";
import {
  MOVEMENT_EXACT_FILTERS,
  matchesInventoryMovementFilters,
  matchesStockCardFilters,
  parseInventoryMovementFilters,
  parseStockCardFilters,
  resolveMovementDocumentKind,
  type MovementDocumentKind,
} from "../utils/inventoryMovementFilters";
import { getInventoryStockStatus } from "../utils/inventoryStockStatus";
import {
  canSeeInventoryReconciliation,
  inventoryOverviewWindowStart,
  type InventoryOverviewItem,
  type ListInventoryOptions,
} from "./inventoryOverview";
import { assertReturnAdjustmentHasDocument } from "./returnAdjustmentDocument";

/**
 * Cifras del libro de un producto, con las reglas de la vista
 * `inventory_overview`: entradas y salidas de la ventana de 30 días y el último
 * movimiento. El mock no tiene `seq`: el último es el de `createdAt` mayor y, a
 * igualdad, el que está antes en `mockStockMovements` (los nuevos entran al
 * principio). `ledgerStock` es Σ de todos sus movimientos.
 */
function summarizeProductLedger(productId: string, windowStart: Date) {
  let entries30d = 0;
  let exits30d = 0;
  let ledgerStock = 0;
  let last: StockMovementMock | undefined;

  for (const movement of mockStockMovements) {
    if (movement.productId !== productId) {
      continue;
    }

    ledgerStock += movement.quantityDelta;

    if (new Date(movement.createdAt) >= windowStart) {
      if (movement.quantityDelta > 0) {
        entries30d += movement.quantityDelta;
      } else {
        exits30d -= movement.quantityDelta;
      }
    }

    if (!last || new Date(movement.createdAt) > new Date(last.createdAt)) {
      last = movement;
    }
  }

  return { entries30d, exits30d, last, ledgerStock };
}

export function listInventory(
  searchParams: URLSearchParams,
  storeId: string,
  options: ListInventoryOptions = {},
) {
  const filters = parseInventoryListFilters(searchParams);
  const windowStart = inventoryOverviewWindowStart();
  const withReconciliation = canSeeInventoryReconciliation(options.role);

  const items = mockProducts
    .filter(
      (product) =>
        (product.storeId ?? DEFAULT_STORE_ID) === storeId &&
        matchesInventoryListFilters(product, filters),
    )
    .map((product): InventoryOverviewItem => {
      const ledger = summarizeProductLedger(product.id, windowStart);
      const diff = product.currentStock - ledger.ledgerStock;

      return {
        ...product,
        category: mockCategories.find((category) => category.id === product.categoryId),
        entries30d: ledger.entries30d,
        exits30d: ledger.exits30d,
        lastMovementAt: ledger.last?.createdAt ?? null,
        lastMovementType: ledger.last?.type ?? null,
        stockStatus: getInventoryStockStatus(product),
        ...(withReconciliation ? { reconciliationDiff: diff === 0 ? null : diff } : {}),
      };
    });

  return paginateList(items, searchParams);
}

/**
 * Movimientos de la tienda en el orden del libro, del más reciente al más
 * antiguo. El mock no tiene `seq`: ordena por `createdAt` y, a igualdad, gana el
 * que está antes en `mockStockMovements` (los nuevos entran al principio; el
 * orden de `sort` es estable).
 */
function listStoreMovementsByLedgerOrder(storeId: string) {
  return mockStockMovements
    .filter((movement) => (movement.storeId ?? DEFAULT_STORE_ID) === storeId)
    .sort(
      (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
    );
}

function withProduct(movement: StockMovementMock) {
  return {
    ...movement,
    product: mockProducts.find((product) => product.id === movement.productId),
  };
}

/** Número de la venta o compra del movimiento; `null` si no tiene (o es una conversión). */
function resolveDocumentNumber(movement: StockMovementMock, kind: MovementDocumentKind | null) {
  if (kind === "venta") {
    return mockSales.find((sale) => sale.id === movement.saleId)?.invoiceNumber ?? null;
  }

  if (kind === "compra") {
    return (
      mockPurchases.find((purchase) => purchase.id === movement.purchaseId)?.purchaseNumber ?? null
    );
  }

  return null;
}

export function listStockMovements(searchParams: URLSearchParams, storeId: string) {
  assertListFilterParams(searchParams, MOVEMENT_EXACT_FILTERS);

  const filters = parseInventoryMovementFilters(searchParams);

  const items = listStoreMovementsByLedgerOrder(storeId)
    .map((movement) => {
      const documentKind = resolveMovementDocumentKind(movement);

      return {
        ...withProduct(movement),
        documentKind,
        documentNumber: resolveDocumentNumber(movement, documentKind),
      };
    })
    .filter((movement) => matchesInventoryMovementFilters(movement, filters));

  return paginateList(items, searchParams);
}

export function getStockCard(searchParams: URLSearchParams, storeId: string) {
  assertListFilterParams(searchParams, MOVEMENT_EXACT_FILTERS);

  const filters = parseStockCardFilters(searchParams);

  const items = listStoreMovementsByLedgerOrder(storeId)
    .filter((movement) => matchesStockCardFilters(movement, filters))
    .map(withProduct);

  return paginateList(items, searchParams);
}

/**
 * Resultados ya devueltos por clave de idempotencia (`operacion:storeId:clave`),
 * como hacen `adjust_stock` y `convert_pack_to_units` en la base: la misma clave
 * devuelve el resultado original sin mover stock otra vez (C6).
 */
const resultsByClientRequest = new Map<string, unknown>();

function requestKeyFor(operation: string, storeId: string, clientRequestId?: string) {
  return clientRequestId ? `${operation}:${storeId}:${clientRequestId}` : null;
}

export function createStockAdjustment(
  input: StockAdjustmentInput & { clientRequestId?: string },
  storeId: string,
) {
  const requestKey = requestKeyFor("adjustment", storeId, input.clientRequestId);
  const previous = requestKey ? resultsByClientRequest.get(requestKey) : undefined;

  if (previous) {
    return previous as ReturnType<typeof applyStockAdjustment>;
  }

  const movement = applyStockAdjustment(input, storeId);

  if (requestKey) {
    resultsByClientRequest.set(requestKey, movement);
  }

  return movement;
}

type StockAdjustmentInput = {
  productId: string;
  purchaseId?: string;
  quantityDelta: number;
  reason?: string;
  saleId?: string;
  type?: StockMovementType;
};

/**
 * R4 / C15, como `adjust_stock`: una devolucion ligada a su venta o compra exige
 * el documento en la tienda, en un estado devolvible, con ese producto, y no
 * puede superar lo vendido (o recibido) menos lo ya devuelto con movimientos
 * ligados al mismo documento.
 */
function assertLinkedReturnAllowed(input: StockAdjustmentInput, storeId: string) {
  assertReturnAdjustmentHasDocument(input);

  if (input.saleId && input.type !== "devolucion_cliente") {
    throw new ApiError(400, "BAD_REQUEST", "Solo una devolucion de cliente puede ligarse a una venta");
  }

  if (input.purchaseId && input.type !== "devolucion_proveedor") {
    throw new ApiError(400, "BAD_REQUEST", "Solo una devolucion a proveedor puede ligarse a una compra");
  }

  if (input.saleId) {
    // Como la RPC: la venta de otra tienda "no existe" (404), no es un 403.
    const sale = mockSales.find(
      (item) => item.id === input.saleId && (item.storeId ?? DEFAULT_STORE_ID) === storeId,
    );

    if (!sale) {
      throw new ApiError(404, "NOT_FOUND", "Venta no encontrada");
    }

    if (input.quantityDelta < 0) {
      throw new ApiError(400, "BAD_REQUEST", "Este tipo de ajuste requiere quantity_delta positivo");
    }

    if (sale.status === "cancelada" || sale.status === "devuelta") {
      throw new ApiError(409, "CONFLICT", "La venta ya fue cancelada o devuelta");
    }

    if (sale.status !== "pagada" && sale.status !== "pendiente_pago") {
      throw new ApiError(409, "CONFLICT", "Solo se pueden devolver ventas pagadas o pendientes de pago");
    }

    const sold = mockSaleItems
      .filter((item) => item.saleId === input.saleId && item.productId === input.productId)
      .reduce((total, item) => total + item.quantity, 0);

    if (sold === 0) {
      throw new ApiError(400, "BAD_REQUEST", "El producto no pertenece a la venta indicada");
    }

    const alreadyReturned = mockStockMovements
      .filter(
        (movement) =>
          movement.saleId === input.saleId &&
          movement.productId === input.productId &&
          movement.type === "devolucion_cliente",
      )
      .reduce((total, movement) => total + movement.quantityDelta, 0);

    if (input.quantityDelta > sold - alreadyReturned) {
      throw new ApiError(
        409,
        "CONFLICT",
        `La devolucion supera lo vendido en la venta ${sale.invoiceNumber}: vendido ${sold}, ya devuelto ${alreadyReturned}`,
      );
    }
  }

  if (input.purchaseId) {
    const purchase = mockPurchases.find(
      (item) => item.id === input.purchaseId && (item.storeId ?? DEFAULT_STORE_ID) === storeId,
    );

    if (!purchase) {
      throw new ApiError(404, "NOT_FOUND", "Compra no encontrada");
    }

    if (input.quantityDelta > 0) {
      throw new ApiError(
        400,
        "BAD_REQUEST",
        "ajuste_salida / devolucion_proveedor requiere quantity_delta negativo",
      );
    }

    if (purchase.status === "cancelado" || purchase.status === "devuelto") {
      throw new ApiError(409, "CONFLICT", "La compra ya fue cancelada o devuelta");
    }

    if (purchase.status !== "recibido") {
      throw new ApiError(409, "CONFLICT", "Solo se pueden devolver compras recibidas");
    }

    const received = mockPurchaseItems
      .filter((item) => item.purchaseId === input.purchaseId && item.productId === input.productId)
      .reduce((total, item) => total + item.quantity, 0);

    if (received === 0) {
      throw new ApiError(400, "BAD_REQUEST", "El producto no pertenece a la compra indicada");
    }

    const alreadyReturned = mockStockMovements
      .filter(
        (movement) =>
          movement.purchaseId === input.purchaseId &&
          movement.productId === input.productId &&
          movement.type === "devolucion_proveedor",
      )
      .reduce((total, movement) => total - movement.quantityDelta, 0);

    if (-input.quantityDelta > received - alreadyReturned) {
      throw new ApiError(
        409,
        "CONFLICT",
        `La devolucion supera lo recibido en la compra ${purchase.purchaseNumber}: recibido ${received}, ya devuelto ${alreadyReturned}`,
      );
    }
  }
}

function applyStockAdjustment(input: StockAdjustmentInput, storeId: string) {
  const product = mockProducts.find((item) => item.id === input.productId);
  assertMockStoreResource(product, storeId, "Producto no encontrado.");
  assertLinkedReturnAllowed(input, storeId);

  const stockAfter = product.currentStock + input.quantityDelta;

  if (stockAfter < 0) {
    throw new ApiError(400, "BAD_REQUEST", "El ajuste no puede dejar stock negativo.");
  }

  product.currentStock = stockAfter;

  const movement = {
    createdAt: new Date().toISOString(),
    id: `mov-mock-${Date.now()}`,
    productId: input.productId,
    ...(input.purchaseId ? { purchaseId: input.purchaseId } : {}),
    quantityDelta: input.quantityDelta,
    reason: input.reason,
    ...(input.saleId ? { saleId: input.saleId } : {}),
    stockAfter,
    storeId,
    type: input.type ?? "ajuste_entrada",
  };

  mockStockMovements.unshift(movement);
  return movement;
}

type PackConversionRequest = {
  /** Reparto real de esta apertura; sin él cada componente recibe lo de la receta. */
  components?: PackDistributionItem[];
  packProductId: string;
  packQuantity: number;
  reason?: string;
};

type StoredPackConversion = {
  fingerprint: string;
  result: ReturnType<typeof applyPackConversion>;
};

/**
 * Huella del contenido de una conversion, como la de `convert_pack_to_units`:
 * sin reparto es la de siempre; con reparto lo incluye tal cual llega.
 */
function packConversionFingerprint(input: PackConversionRequest) {
  return JSON.stringify([
    input.packProductId,
    input.packQuantity,
    input.reason ?? null,
    ...(input.components
      ? [input.components.map((item) => [item.unitProductId, item.units])]
      : []),
  ]);
}

export function convertPackToUnits(
  input: PackConversionRequest & { clientRequestId?: string },
  storeId: string,
) {
  const requestKey = requestKeyFor("conversion", storeId, input.clientRequestId);
  const previous = requestKey
    ? (resultsByClientRequest.get(requestKey) as StoredPackConversion | undefined)
    : undefined;
  const fingerprint = packConversionFingerprint(input);

  if (previous) {
    // Misma clave con otro contenido (otro reparto, o sin reparto): PT409 en la base.
    if (previous.fingerprint !== fingerprint) {
      throw new ApiError(
        409,
        "CONFLICT",
        "La clave de idempotencia ya se uso en otro movimiento de inventario. Revisa el movimiento registrado antes de reintentar.",
      );
    }

    return previous.result;
  }

  const result = applyPackConversion(input, storeId);

  if (requestKey) {
    resultsByClientRequest.set(requestKey, { fingerprint, result } satisfies StoredPackConversion);
  }

  return result;
}

/** Division entera redondeando la mitad lejos de cero, como `round()` de numeric. */
function divideRounded(numerator: bigint, denominator: bigint) {
  const zero = BigInt(0);
  const two = BigInt(2);
  const magnitude = numerator < zero ? -numerator : numerator;
  const rounded = (two * magnitude + denominator) / (two * denominator);

  return numerator < zero ? -rounded : rounded;
}

/** Los pesos de costo entran al reparto con 6 decimales (y nunca como 0). */
const COST_WEIGHT_SCALE = 1_000_000;

/**
 * Reparto del valor de una apertura entre sus componentes, copia de
 * `convert_pack_to_units` (parche 20261009d). `components` llega ordenado por id.
 * - valor transferido = empaques x costo del empaque (4 decimales);
 * - parte de cada componente con unidades = round(valor x (unidades x peso) /
 *   suma(unidades x peso), 4); el residuo del redondeo va al de mayor
 *   (unidades x peso) y, si empatan, al de mayor id: la suma es el valor exacto;
 * - costo nuevo = promedio ponderado round(..., 2); sin stock previo,
 *   round(parte / unidades, 2).
 * Todo en enteros (centimos y diezmilesimas) para redondear igual que la base.
 */
function splitPackConversionValue(params: {
  components: { costRef: number; costWeight: number; stock: number; units: number }[];
  packCostRef: number;
  packQuantity: number;
}) {
  const hundred = BigInt(100);
  const valueE4 = BigInt(params.packQuantity) * BigInt(Math.round(params.packCostRef * 100)) * hundred;
  const weights = params.components.map(
    (component) =>
      BigInt(component.units) *
      BigInt(Math.max(1, Math.round(component.costWeight * COST_WEIGHT_SCALE))),
  );
  const weightTotal = weights.reduce((total, weight) => total + weight, BigInt(0));
  const unitsOut = params.components.reduce((total, component) => total + component.units, 0);

  let residualIndex = -1;

  params.components.forEach((component, index) => {
    // `>=`: con el mismo peso gana el de mayor id (el ultimo, la lista va por id).
    if (component.units > 0 && (residualIndex < 0 || weights[index] >= weights[residualIndex])) {
      residualIndex = index;
    }
  });

  const sharesE4 = params.components.map((component, index) =>
    component.units > 0 && index !== residualIndex
      ? divideRounded(valueE4 * weights[index], weightTotal)
      : BigInt(0),
  );

  sharesE4[residualIndex] = valueE4 - sharesE4.reduce((total, share) => total + share, BigInt(0));

  return {
    components: params.components.map((component, index) => {
      if (component.units === 0) {
        return null;
      }

      const shareE4 = sharesE4[index];
      const unitCostE2 = divideRounded(shareE4, BigInt(component.units) * hundred);
      const newCostE2 =
        component.stock <= 0
          ? unitCostE2
          : divideRounded(
              BigInt(component.stock) * BigInt(Math.round(component.costRef * 100)) * hundred + shareE4,
              BigInt(component.stock + component.units) * hundred,
            );

      return {
        allocatedValueRef: Number(shareE4) / 10000,
        newCostRef: Number(newCostE2) / 100,
        unitCostRef: Number(unitCostE2) / 100,
      };
    }),
    unitCostRef: Number(divideRounded(valueE4, BigInt(unitsOut) * hundred)) / 100,
  };
}

/**
 * Como `stock_movements_apply` en la base: el movimiento y el stock del producto
 * cambian juntos, y `stockAfter` es el stock que deja el movimiento.
 */
function recordConversionMovement(
  product: ProductMock,
  movement: Pick<StockMovementMock, "conversionId" | "createdAt" | "id" | "quantityDelta" | "reason"> & {
    type: "conversion_entrada" | "conversion_salida";
  },
  storeId: string,
) {
  const stockAfter = product.currentStock + movement.quantityDelta;

  product.currentStock = stockAfter;

  return { ...movement, productId: product.id, stockAfter, storeId };
}

function applyPackConversion(input: PackConversionRequest, storeId: string) {
  const link = mockProductPackConversions.find(
    (item) =>
      item.isActive &&
      item.storeId === storeId &&
      item.packProductId === input.packProductId,
  );

  if (!link) {
    throw new ApiError(
      400,
      "BAD_REQUEST",
      "El producto no tiene conversion de empaque a unidad activa.",
    );
  }

  const pack = mockProducts.find((item) => item.id === link.packProductId);
  assertMockStoreResource(pack, storeId, "Producto de empaque no encontrado.");

  // Por id de producto, como la RPC: fija el orden de las entradas y el desempate del residuo.
  const recipe = [...link.components]
    .sort((left, right) =>
      left.unitProductId < right.unitProductId ? -1 : left.unitProductId > right.unitProductId ? 1 : 0,
    )
    .map((component) => {
      const product = mockProducts.find((item) => item.id === component.unitProductId);
      assertMockStoreResource(product, storeId, "Producto unidad no encontrado.");

      return { ...component, product };
    });

  if (input.packQuantity <= 0) {
    throw new ApiError(400, "BAD_REQUEST", "La cantidad de empaques debe ser mayor a cero.");
  }

  const recipeUnits = recipe.reduce((total, component) => total + component.unitsPerPack, 0);

  if (recipe.length === 0 || recipeUnits !== link.totalUnits) {
    throw new ApiError(
      409,
      "CONFLICT",
      "La receta del empaque esta incompleta: sus componentes no suman las unidades del empaque",
    );
  }

  if (input.components) {
    assertPackDistribution(
      {
        componentIds: recipe.map((component) => component.unitProductId),
        totalUnits: link.totalUnits,
      },
      input.packQuantity,
      input.components,
    );
  }

  if (pack.currentStock < input.packQuantity) {
    throw new ApiError(400, "BAD_REQUEST", "Stock insuficiente de empaque.");
  }

  const distribution = input.components;
  const opened = recipe.map((component) => ({
    ...component,
    units: distribution
      ? (distribution.find((item) => item.unitProductId === component.unitProductId)?.units ?? 0)
      : component.unitsPerPack * input.packQuantity,
  }));
  const split = splitPackConversionValue({
    components: opened.map((component) => ({
      costRef: component.product.currentCostRef,
      costWeight: component.costWeight,
      stock: component.product.currentStock,
      units: component.units,
    })),
    packCostRef: pack.currentCostRef,
    packQuantity: input.packQuantity,
  });

  const now = Date.now();
  const conversionId = `conv-mock-${now}`;
  const createdAt = new Date().toISOString();
  const packMovement = recordConversionMovement(
    pack,
    {
      conversionId,
      createdAt,
      id: `mov-pack-${now}`,
      quantityDelta: -input.packQuantity,
      reason: input.reason,
      type: "conversion_salida",
    },
    storeId,
  );

  // Una entrada por componente con unidades; los 0 no dejan movimiento.
  const components = opened.flatMap((component, index) => {
    const allocation = split.components[index];

    if (!allocation) {
      return [];
    }

    component.product.currentCostRef = allocation.newCostRef;

    return [
      {
        ...allocation,
        costWeight: component.costWeight,
        isActive: component.product.isActive !== false,
        movement: recordConversionMovement(
          component.product,
          {
            conversionId,
            createdAt,
            id: index === 0 ? `mov-unit-${now}` : `mov-unit-${now}-${index}`,
            quantityDelta: component.units,
            reason: input.reason,
            type: "conversion_entrada",
          },
          storeId,
        ),
        unitProductId: component.unitProductId,
        units: component.units,
      },
    ];
  });

  mockStockMovements.unshift(...components.map((component) => component.movement), packMovement);

  return {
    components,
    conversionId,
    packMovement,
    packQuantity: input.packQuantity,
    totalUnits: link.totalUnits,
    // Costo medio por unidad; en un surtido cada componente trae el suyo.
    unitCostRef: split.unitCostRef,
    // La entrada del primer componente por id, como la RPC.
    unitMovement: components[0].movement,
    unitQuantity: link.totalUnits * input.packQuantity,
    unitsPerPack: link.totalUnits,
  };
}

export { listPackConversions };
