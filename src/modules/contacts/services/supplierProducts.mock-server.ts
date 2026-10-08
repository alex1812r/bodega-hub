import { ApiError } from "@/lib/api/apiError";
import { assertMockStoreResource, mockEntityStoreId } from "@/lib/api/assertStoreResource";
import { paginateList } from "@/lib/api/pagination";
import {
  mockCategories,
  mockContacts,
  mockProducts,
  mockSupplierProductPackUnits,
  mockSupplierProductPriceHistory,
  mockSupplierProducts,
  type SupplierProductMock,
  type SupplierProductPackUnitMock,
  type SupplierProductPriceHistoryMock,
  type SupplierProductPriceOrigin,
} from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import {
  mergeProductSupplierInputs,
  PRODUCT_SUPPLIERS_MAX,
  PRODUCT_SUPPLIERS_MESSAGES,
  sortProductSupplierLinks,
  type ProductPreferredSupplier,
  type ProductSupplierInput,
  type ProductSupplierLink,
  type SaveProductSuppliersResult,
} from "@/modules/products/services/productSuppliers";
import { matchesProductSearch } from "@/modules/products/services/productSearch";
import { isSupplierContactType } from "@/shared/auth/contactAccess";
import { normalizeOptionalSku } from "@/shared/utils/skuGeneration";
import { parseSupplierProductSort, sortSupplierProductItems } from "./supplierProductSort";

import type {
  SupplierProductCreateInput,
  SupplierProductMetadataUpdateInput,
  SupplierProductPackUnitInput,
  SupplierProductPackUnitUpdateInput,
  SupplierProductRegisterPriceInput,
} from "../types/supplierProducts";

const supplierProducts = [...mockSupplierProducts];
const priceHistory = [...mockSupplierProductPriceHistory];
const packUnits = [...mockSupplierProductPackUnits];

// --- Proveedor habitual: las mismas reglas que los triggers del parche 20261009e ---

function isLinkActive(relation: SupplierProductMock) {
  return relation.isActive ?? true;
}

/** Proveedor activo y de tipo proveedor / ambos: el único que puede ser habitual. */
function isUsableSupplier(supplierId: string) {
  const contact = mockContacts.find((item) => item.id === supplierId);

  return Boolean(contact?.isActive && isSupplierContactType(contact.type));
}

function findPreferredLink(productId: string) {
  return supplierProducts.find((item) => item.productId === productId && item.isPreferred);
}

/**
 * Relevo determinista (`supplier_products_next_preferred`): entre los vínculos
 * activos de proveedores activos, el de compra más reciente; sin compras, el
 * más antiguo; desempate por id.
 */
function pickNextPreferred(productId: string) {
  return supplierProducts
    .filter(
      (item) =>
        item.productId === productId && isLinkActive(item) && isUsableSupplier(item.supplierId),
    )
    .sort(
      (first, second) =>
        (second.lastPurchasedAt ?? "").localeCompare(first.lastPurchasedAt ?? "") ||
        (first.createdAt ?? "").localeCompare(second.createdAt ?? "") ||
        first.id.localeCompare(second.id),
    )[0];
}

/** El producto se quedó sin habitual: pasa al relevo, si lo hay. */
function handOffPreferred(productId: string) {
  if (findPreferredLink(productId)) {
    return;
  }

  const next = pickNextPreferred(productId);

  if (next) {
    next.isPreferred = true;
  }
}

/** El vínculo deja de ser habitual (se desactiva, se borra o cambia de producto). */
function releasePreferred(relation: SupplierProductMock, productId = relation.productId) {
  if (!relation.isPreferred) {
    return;
  }

  relation.isPreferred = false;
  handOffPreferred(productId);
}

/** Un vínculo que entra a los activos de un producto sin habitual queda habitual. */
function markPreferredIfFirst(relation: SupplierProductMock) {
  if (
    isLinkActive(relation) &&
    !relation.isPreferred &&
    !findPreferredLink(relation.productId) &&
    isUsableSupplier(relation.supplierId)
  ) {
    relation.isPreferred = true;
  }
}

/**
 * Un habitual nunca es un vínculo inactivo ni de un proveedor inactivo (trigger
 * de `contacts` en la base): se suelta y el producto pasa al relevo. Se llama
 * al entrar a cada operación porque el mock de contactos no avisa.
 */
function settlePreferred() {
  for (const relation of supplierProducts) {
    if (relation.isPreferred && !(isLinkActive(relation) && isUsableSupplier(relation.supplierId))) {
      releasePreferred(relation);
    }
  }
}

// Como el backfill del parche: un habitual por producto con vínculos activos.
for (const productId of new Set(supplierProducts.map((item) => item.productId))) {
  handOffPreferred(productId);
}

function computeVariationPercent(oldCostRef: number | undefined, newCostRef: number) {
  if (oldCostRef === undefined || oldCostRef <= 0) {
    return null;
  }

  return Number((((newCostRef - oldCostRef) / oldCostRef) * 100).toFixed(2));
}

function getLatestHistory(supplierProductId: string) {
  return priceHistory
    .filter((entry) => entry.supplierProductId === supplierProductId)
    .sort((first, second) => second.createdAt.localeCompare(first.createdAt));
}

function normalizePackUnit(packUnit: SupplierProductPackUnitMock) {
  return {
    ...packUnit,
    isActive: packUnit.isActive ?? true,
    isDefault: packUnit.isDefault ?? false,
  };
}

function enrichSupplierProduct(relation: SupplierProductMock) {
  const latest = getLatestHistory(relation.id);
  const previous = latest[1];
  const relationPackUnits = packUnits
    .filter(
      (packUnit) => packUnit.supplierProductId === relation.id && (packUnit.isActive ?? true),
    )
    .map(normalizePackUnit);
  const defaultPackUnit =
    relationPackUnits.find((packUnit) => packUnit.isDefault) ?? relationPackUnits[0];
  const product = mockProducts.find((item) => item.id === relation.productId);
  const category = product
    ? mockCategories.find((item) => item.id === product.categoryId)
    : undefined;

  return {
    ...relation,
    defaultPackUnit,
    isActive: relation.isActive ?? true,
    isPreferred: relation.isPreferred ?? false,
    lastPriceOrigin: relation.lastPriceOrigin ?? latest[0]?.origin,
    packUnits: relationPackUnits,
    product: product
      ? {
          ...product,
          taxRate: category?.taxRate ?? 0,
        }
      : undefined,
    supplier: mockContacts.find((contact) => contact.id === relation.supplierId),
    variationPercent:
      relation.variationPercent ??
      (previous
        ? computeVariationPercent(previous.newCostRef, relation.lastCostRef)
        : null),
  };
}

function appendHistory(input: {
  newCostRef: number;
  newCostVes?: number;
  notes?: string;
  oldCostRef?: number;
  oldCostVes?: number;
  origin: SupplierProductPriceOrigin;
  supplierProductId: string;
}) {
  const entry: SupplierProductPriceHistoryMock = {
    changedBy: "user-almacen",
    createdAt: new Date().toISOString(),
    id: `sph-mock-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    newCostRef: input.newCostRef,
    newCostVes: input.newCostVes,
    notes: input.notes,
    oldCostRef: input.oldCostRef,
    oldCostVes: input.oldCostVes,
    origin: input.origin,
    supplierProductId: input.supplierProductId,
    variationPercent: computeVariationPercent(input.oldCostRef, input.newCostRef),
  };

  priceHistory.unshift(entry);
  return entry;
}

function findRelation(id: string) {
  const relation = supplierProducts.find((item) => item.id === id);

  if (!relation) {
    throw new ApiError(404, "NOT_FOUND", "Relacion proveedor-producto no encontrada.");
  }

  return relation;
}

function findLink(supplierId: string, productId: string) {
  return supplierProducts.find(
    (item) => item.supplierId === supplierId && item.productId === productId,
  );
}

function assertUniqueActiveLink(supplierId: string, productId: string, excludeId?: string) {
  const duplicate = supplierProducts.find(
    (item) =>
      item.supplierId === supplierId &&
      item.productId === productId &&
      item.id !== excludeId &&
      (item.isActive ?? true),
  );

  if (duplicate) {
    throw new ApiError(409, "CONFLICT", "Ya existe una relacion para este proveedor y producto.");
  }
}

function applyInitialPrice(
  relation: SupplierProductMock,
  input: SupplierProductCreateInput,
  rollback: () => void,
) {
  if (input.lastCostRef == null || input.lastCostRef < 0) {
    return;
  }

  try {
    appendHistory({
      newCostRef: input.lastCostRef,
      newCostVes: input.lastCostVes,
      notes: input.notes,
      origin: "vinculacion",
      supplierProductId: relation.id,
    });

    relation.lastCostRef = input.lastCostRef;
    relation.lastCostVes = input.lastCostVes;
    relation.lastPriceOrigin = "vinculacion";
  } catch (error) {
    rollback();
    throw error;
  }
}

function matchesSupplierProductSearch(relation: SupplierProductMock, search: string) {
  const term = search.trim().toLowerCase();
  if (!term) {
    return true;
  }

  const product = mockProducts.find((item) => item.id === relation.productId);

  return (
    (product ? matchesProductSearch(product, term) : false) ||
    relation.supplierSku?.toLowerCase().includes(term) === true
  );
}

export function listSupplierProducts(searchParams: URLSearchParams, storeId: string) {
  settlePreferred();
  const productId = searchParams.get("productId");
  const supplierId = searchParams.get("supplierId");
  const isActive = searchParams.get("isActive");
  const search = searchParams.get("search");

  const items = supplierProducts
    .filter((relation) => {
      const matchesActive =
        isActive == null ||
        isActive === "" ||
        String(relation.isActive ?? true) === isActive.toLowerCase();

      return (
        (relation.storeId ?? DEFAULT_STORE_ID) === storeId &&
        matchesActive &&
        (!productId || relation.productId === productId) &&
        (!supplierId || relation.supplierId === supplierId) &&
        matchesSupplierProductSearch(relation, search ?? "")
      );
    })
    .map(enrichSupplierProduct);

  const { sortBy, sortOrder } = parseSupplierProductSort(searchParams);
  const sortedItems = sortSupplierProductItems(items, sortBy, sortOrder);

  return paginateList(sortedItems, searchParams);
}

export function listProductSuppliers(productId: string, searchParams: URLSearchParams, storeId: string) {
  const params = new URLSearchParams(searchParams);
  params.set("productId", productId);

  return listSupplierProducts(params, storeId);
}

export function listSupplierProductsBySupplier(supplierId: string, searchParams: URLSearchParams, storeId: string) {
  const params = new URLSearchParams(searchParams);
  params.set("supplierId", supplierId);

  return listSupplierProducts(params, storeId);
}

export function getSupplierProductById(id: string, storeId: string) {
  settlePreferred();
  const relation = findRelation(id);
  assertMockStoreResource(relation, storeId, "Relacion proveedor-producto no encontrada.");
  return enrichSupplierProduct(relation);
}

export function createSupplierProduct(input: SupplierProductCreateInput, storeId: string) {
  settlePreferred();
  const existing = findLink(input.supplierId, input.productId);

  if (existing) {
    if (existing.isActive !== false) {
      throw new ApiError(409, "CONFLICT", "Ya existe una relacion para este proveedor y producto.");
    }

    const now = new Date().toISOString();

    existing.isActive = true;
    if (input.supplierSku !== undefined) {
      existing.supplierSku = normalizeOptionalSku(input.supplierSku) ?? undefined;
    }
    if (input.notes !== undefined) existing.notes = input.notes;
    existing.updatedAt = now;
    markPreferredIfFirst(existing);

    applyInitialPrice(existing, input, () => {
      existing.isActive = false;
      releasePreferred(existing);
    });

    return enrichSupplierProduct(existing);
  }

  const now = new Date().toISOString();
  const relation: SupplierProductMock = {
    createdAt: now,
    id: `supp-prod-mock-${Date.now()}`,
    isActive: true,
    lastCostRef: 0,
    notes: input.notes,
    productId: input.productId,
    storeId,
    supplierId: input.supplierId,
    supplierSku: normalizeOptionalSku(input.supplierSku) ?? undefined,
    updatedAt: now,
    variationPercent: null,
  };

  supplierProducts.unshift(relation);
  markPreferredIfFirst(relation);

  applyInitialPrice(relation, input, () => {
    const index = supplierProducts.indexOf(relation);
    if (index >= 0) {
      supplierProducts.splice(index, 1);
    }
    handOffPreferred(relation.productId);
  });

  return enrichSupplierProduct(relation);
}

export function updateSupplierProduct(id: string, input: SupplierProductMetadataUpdateInput, storeId: string) {
  settlePreferred();
  const relation = findRelation(id);
  assertMockStoreResource(relation, storeId, "Relacion proveedor-producto no encontrada.");
  const before = { isActive: isLinkActive(relation), productId: relation.productId };

  if (
    relation.isPreferred &&
    input.isActive !== false &&
    (input.productId ?? relation.productId) === relation.productId &&
    input.supplierId !== undefined &&
    !isUsableSupplier(input.supplierId)
  ) {
    throw new ApiError(
      400,
      "BAD_REQUEST",
      "Un proveedor inactivo no puede ser el habitual del producto.",
    );
  }

  if (input.supplierId && input.productId) {
    assertUniqueActiveLink(input.supplierId, input.productId, id);
  } else if (input.supplierId) {
    assertUniqueActiveLink(input.supplierId, relation.productId, id);
  } else if (input.productId) {
    assertUniqueActiveLink(relation.supplierId, input.productId, id);
  }

  if (input.supplierId !== undefined) relation.supplierId = input.supplierId;
  if (input.productId !== undefined) relation.productId = input.productId;
  if (input.supplierSku !== undefined) {
    relation.supplierSku = normalizeOptionalSku(input.supplierSku) ?? undefined;
  }
  if (input.notes !== undefined) relation.notes = input.notes;
  if (input.isActive !== undefined) relation.isActive = input.isActive;
  relation.updatedAt = new Date().toISOString();

  if (relation.productId !== before.productId) {
    // El habitual no viaja con el vínculo a otro producto.
    releasePreferred(relation, before.productId);
    markPreferredIfFirst(relation);
  } else if (!isLinkActive(relation)) {
    releasePreferred(relation);
  } else if (!before.isActive) {
    markPreferredIfFirst(relation);
  }

  return enrichSupplierProduct(relation);
}

export function registerSupplierProductPrice(id: string,
  input: SupplierProductRegisterPriceInput, storeId: string) {
  settlePreferred();
  const relation = findRelation(id);
  assertMockStoreResource(relation, storeId, "Relacion proveedor-producto no encontrada.");

  if (relation.isActive === false) {
    throw new ApiError(400, "BAD_REQUEST", "No se puede registrar precio en una relacion inactiva.");
  }

  const origin = input.origin ?? "cotizacion";
  const history = appendHistory({
    newCostRef: input.newCostRef,
    newCostVes: input.newCostVes,
    notes: input.notes,
    oldCostRef: relation.lastCostRef,
    oldCostVes: relation.lastCostVes,
    origin,
    supplierProductId: id,
  });

  relation.lastCostRef = input.newCostRef;
  relation.lastCostVes = input.newCostVes ?? relation.lastCostVes;
  if (input.priceInputMode === "pack") {
    relation.lastPackCostRef = input.newPackCostRef;
  } else if (input.priceInputMode === "unit") {
    relation.lastPackCostRef = undefined;
  }
  relation.lastPriceOrigin = origin;
  relation.updatedAt = history.createdAt;
  if (origin === "compra") {
    relation.lastPurchasedAt = history.createdAt;
  }

  return {
    historyId: history.id,
    supplierProduct: enrichSupplierProduct(relation),
    variationPercent: history.variationPercent ?? null,
  };
}

/** Línea de una compra tal como la necesita el vínculo proveedor-producto. */
export type PurchaseLinkLine = {
  /** Costo por unidad con el IVA de la línea (el que la compra fija en el producto). */
  costRef: number;
  costVes?: number;
  /** Solo si la línea se guarda en modo empaque. */
  pack?: { label: string; unitsPerPack: number };
  productId: string;
  supplierSku?: string;
};

let purchaseLinkSequence = 0;

/** Sufijo de id: varias líneas de una compra se crean en el mismo milisegundo. */
function nextPurchaseLinkSequence() {
  purchaseLinkSequence += 1;

  return purchaseLinkSequence;
}

/**
 * COM-02 · lo que `create_purchase` (parche 20261010a) hace con los vínculos del
 * proveedor al confirmar una compra, línea a línea:
 * - recibida: crea el vínculo que falte, reactiva el inactivo y registra el costo
 *   de la línea con origen `compra`;
 * - en pedido: crea el que falte con el costo de la línea (origen `vinculacion`,
 *   sin fecha de última compra), reactiva el inactivo sin tocar su costo y no
 *   toca el activo;
 * - línea por empaque sobre un vínculo creado en ESTA compra: añade su empaque
 *   (el primero queda predeterminado); los vínculos que ya existían conservan
 *   los suyos;
 * - habitual: el vínculo que entra a los activos queda habitual solo si el
 *   producto no tenía ninguno.
 * Nunca duplica un vínculo. Devuelve los ids de los vínculos creados.
 */
export function linkPurchaseLines(
  lines: PurchaseLinkLine[],
  purchase: { purchaseNumber: string; received: boolean; supplierId: string },
  storeId: string,
) {
  settlePreferred();
  const createdIds: string[] = [];

  for (const line of lines) {
    const now = new Date().toISOString();
    let relation = findLink(purchase.supplierId, line.productId);

    if (!relation) {
      relation = {
        createdAt: now,
        id: `supp-prod-mock-${Date.now()}-${nextPurchaseLinkSequence()}`,
        isActive: true,
        lastCostRef: line.costRef,
        lastCostVes: line.costVes,
        lastPriceOrigin: purchase.received ? "compra" : "vinculacion",
        lastPurchasedAt: purchase.received ? now : undefined,
        productId: line.productId,
        storeId,
        supplierId: purchase.supplierId,
        supplierSku: line.supplierSku,
        updatedAt: now,
        variationPercent: null,
      };
      supplierProducts.unshift(relation);
      createdIds.push(relation.id);
      markPreferredIfFirst(relation);
      appendHistory({
        newCostRef: line.costRef,
        newCostVes: line.costVes,
        notes: `${purchase.received ? "Compra" : "Pedido"} ${purchase.purchaseNumber}`,
        origin: purchase.received ? "compra" : "vinculacion",
        supplierProductId: relation.id,
      });
    } else {
      if (!isLinkActive(relation)) {
        relation.isActive = true;
        relation.updatedAt = now;
        markPreferredIfFirst(relation);
      }

      if (purchase.received) {
        appendHistory({
          newCostRef: line.costRef,
          newCostVes: line.costVes,
          notes: `Compra ${purchase.purchaseNumber}`,
          oldCostRef: relation.lastCostRef,
          oldCostVes: relation.lastCostVes,
          origin: "compra",
          supplierProductId: relation.id,
        });
        relation.supplierSku = line.supplierSku ?? relation.supplierSku;
        relation.lastCostRef = line.costRef;
        relation.lastCostVes = line.costVes;
        relation.lastPriceOrigin = "compra";
        relation.lastPurchasedAt = now;
        relation.updatedAt = now;
      }
    }

    const { pack } = line;
    const linkId = relation.id;

    if (pack && createdIds.includes(linkId)) {
      const linkPackUnits = packUnits.filter((item) => item.supplierProductId === linkId);
      const alreadyThere = linkPackUnits.some(
        (item) =>
          item.unitsPerPack === pack.unitsPerPack &&
          item.label.toLowerCase() === pack.label.toLowerCase(),
      );

      if (!alreadyThere) {
        packUnits.push({
          id: `sp-pack-mock-${Date.now()}-${nextPurchaseLinkSequence()}`,
          isActive: true,
          isDefault: !linkPackUnits.some((item) => item.isDefault && (item.isActive ?? true)),
          label: pack.label,
          supplierProductId: linkId,
          unitsPerPack: pack.unitsPerPack,
        });
      }
    }
  }

  return createdIds;
}

export function deactivateSupplierProduct(id: string, storeId: string) {
  settlePreferred();
  const relation = findRelation(id);
  assertMockStoreResource(relation, storeId, "Relacion proveedor-producto no encontrada.");
  relation.isActive = false;
  relation.updatedAt = new Date().toISOString();
  releasePreferred(relation);

  return enrichSupplierProduct(relation);
}

function toProductSupplierLink(relation: SupplierProductMock): ProductSupplierLink {
  const supplier = mockContacts.find((contact) => contact.id === relation.supplierId);

  return {
    costRef: relation.lastCostRef,
    id: relation.id,
    isPreferred: relation.isPreferred ?? false,
    ...(relation.lastPurchasedAt ? { lastPurchasedAt: relation.lastPurchasedAt } : {}),
    supplierId: relation.supplierId,
    supplierIsActive: supplier?.isActive ?? false,
    supplierName: supplier?.name ?? "",
    ...(relation.supplierSku ? { supplierSku: relation.supplierSku } : {}),
    ...(relation.updatedAt ? { updatedAt: relation.updatedAt } : {}),
  };
}

let savedLinkSequence = 0;

/**
 * Estado deseado de los vínculos activos de un producto, con las reglas de la
 * RPC `save_product_suppliers`: crea o reactiva los que faltan, cambia costo
 * (con su historial) y código, desactiva los que no vienen y fija el habitual.
 * Valida todo antes de escribir: un rechazo no deja nada a medias.
 */
export function saveProductSuppliers(
  productId: string,
  input: ProductSupplierInput[],
  storeId: string,
): SaveProductSuppliersResult {
  settlePreferred();
  assertMockStoreResource(
    mockProducts.find((item) => item.id === productId),
    storeId,
    "Producto no encontrado.",
  );

  if (input.length > PRODUCT_SUPPLIERS_MAX) {
    throw new ApiError(
      400,
      "BAD_REQUEST",
      `Un producto admite como máximo ${PRODUCT_SUPPLIERS_MAX} proveedores.`,
    );
  }

  const wanted = mergeProductSupplierInputs(input);

  if (wanted.filter((item) => item.isPreferred).length > 1) {
    throw new ApiError(400, "BAD_REQUEST", PRODUCT_SUPPLIERS_MESSAGES.manyPreferred);
  }

  const suppliers = wanted.map((item) => {
    const contact = mockContacts.find((candidate) => candidate.id === item.supplierId);

    if (!contact || mockEntityStoreId(contact) !== storeId || !isSupplierContactType(contact.type)) {
      throw new ApiError(400, "BAD_REQUEST", PRODUCT_SUPPLIERS_MESSAGES.supplierNotFound);
    }

    return contact;
  });

  const previousPreferredSupplierId = findPreferredLink(productId)?.supplierId ?? null;

  wanted.forEach((item, index) => {
    const link = findLink(item.supplierId, productId);

    if (!suppliers[index].isActive && !(link && isLinkActive(link))) {
      throw new ApiError(
        400,
        "BAD_REQUEST",
        PRODUCT_SUPPLIERS_MESSAGES.inactiveLink(suppliers[index].name),
      );
    }
  });

  const markedIndex = wanted.findIndex((item) => item.isPreferred);
  const previousIndex = wanted.findIndex((item) => item.supplierId === previousPreferredSupplierId);
  let targetSupplierId: string | null;

  if (markedIndex >= 0) {
    if (!suppliers[markedIndex].isActive) {
      throw new ApiError(
        400,
        "BAD_REQUEST",
        PRODUCT_SUPPLIERS_MESSAGES.inactivePreferred(suppliers[markedIndex].name),
      );
    }

    targetSupplierId = wanted[markedIndex].supplierId;
  } else if (previousIndex >= 0 && suppliers[previousIndex].isActive) {
    targetSupplierId = previousPreferredSupplierId;
  } else {
    targetSupplierId = suppliers.find((contact) => contact.isActive)?.id ?? null;
  }

  const now = new Date().toISOString();
  const wantedIds = new Set(wanted.map((item) => item.supplierId));

  for (const link of supplierProducts) {
    if (link.productId !== productId) {
      continue;
    }

    // Se apaga el habitual anterior antes de encender el nuevo.
    if (link.isPreferred && link.supplierId !== targetSupplierId) {
      link.isPreferred = false;
    }

    if (isLinkActive(link) && !wantedIds.has(link.supplierId)) {
      link.isActive = false;
      link.updatedAt = now;
    }
  }

  for (const item of wanted) {
    const isTarget = item.supplierId === targetSupplierId;
    let link = findLink(item.supplierId, productId);
    const isNew = !link || !isLinkActive(link);

    if (!link) {
      savedLinkSequence += 1;
      link = {
        createdAt: now,
        id: `supp-prod-mock-${Date.now()}-${savedLinkSequence}`,
        isActive: true,
        lastCostRef: 0,
        productId,
        storeId,
        supplierId: item.supplierId,
        updatedAt: now,
        variationPercent: null,
      };
      supplierProducts.unshift(link);
    }

    if (isNew || (link.isPreferred ?? false) !== isTarget) {
      link.isActive = true;
      link.isPreferred = isTarget;
      link.updatedAt = now;
    }

    if (item.supplierSku !== undefined && (link.supplierSku ?? null) !== item.supplierSku) {
      link.supplierSku = item.supplierSku ?? undefined;
      link.updatedAt = now;
    }

    // Como `register_supplier_product_price` en modo unidad: historial y sin precio de empaque.
    if (item.costRef !== undefined && (isNew || item.costRef !== link.lastCostRef)) {
      const origin: SupplierProductPriceOrigin = isNew ? "vinculacion" : "ajuste";
      const history = appendHistory({
        newCostRef: item.costRef,
        oldCostRef: link.lastCostRef,
        oldCostVes: link.lastCostVes,
        origin,
        supplierProductId: link.id,
      });

      link.lastCostRef = item.costRef;
      link.lastCostVes = undefined;
      link.lastPackCostRef = undefined;
      link.lastPriceOrigin = origin;
      link.variationPercent = history.variationPercent ?? null;
      link.updatedAt = history.createdAt;
    }
  }

  const preferredSupplierId = findPreferredLink(productId)?.supplierId ?? null;

  return {
    preferredAutoAssigned: markedIndex < 0 && preferredSupplierId !== previousPreferredSupplierId,
    preferredChanged: preferredSupplierId !== previousPreferredSupplierId,
    preferredSupplierId,
    previousPreferredSupplierId,
    suppliers: sortProductSupplierLinks(
      supplierProducts
        .filter((link) => link.productId === productId && isLinkActive(link))
        .map(toProductSupplierLink),
    ),
  };
}

/** Proveedor habitual de cada producto pedido (los que no tienen no aparecen). */
export function listPreferredSuppliersByProduct(productIds: string[], storeId: string) {
  settlePreferred();

  const wanted = new Set(productIds);
  const preferred = new Map<string, ProductPreferredSupplier>();

  for (const link of supplierProducts) {
    const supplier = mockContacts.find((contact) => contact.id === link.supplierId);

    if (link.isPreferred && wanted.has(link.productId) && supplier && mockEntityStoreId(link) === storeId) {
      preferred.set(link.productId, { id: supplier.id, name: supplier.name });
    }
  }

  return preferred;
}

export function listSupplierProductPriceHistory(id: string, searchParams: URLSearchParams, storeId: string) {
  getSupplierProductById(id, storeId);

  const items = priceHistory
    .filter((entry) => entry.supplierProductId === id)
    .sort((first, second) => second.createdAt.localeCompare(first.createdAt));

  return paginateList(items, searchParams);
}

function findPackUnit(supplierProductId: string, packUnitId: string) {
  const packUnit = packUnits.find(
    (item) => item.id === packUnitId && item.supplierProductId === supplierProductId,
  );

  if (!packUnit) {
    throw new ApiError(404, "NOT_FOUND", "Empaque no encontrado.");
  }

  return packUnit;
}

export function listSupplierProductPackUnits(supplierProductId: string, storeId: string) {
  getSupplierProductById(supplierProductId, storeId);

  return packUnits
    .filter((item) => item.supplierProductId === supplierProductId)
    .map((item) => ({ ...item, isActive: item.isActive ?? true, isDefault: item.isDefault ?? false }));
}

export function createSupplierProductPackUnit(supplierProductId: string,
  input: SupplierProductPackUnitInput, storeId: string) {
  getSupplierProductById(supplierProductId, storeId);

  const isDefault = input.isDefault ?? false;

  if (isDefault) {
    for (const item of packUnits) {
      if (item.supplierProductId === supplierProductId) {
        item.isDefault = false;
      }
    }
  }

  const created: SupplierProductPackUnitMock = {
    id: `sp-pack-mock-${Date.now()}`,
    isActive: true,
    isDefault,
    label: input.label.trim(),
    supplierProductId,
    unitsPerPack: input.unitsPerPack,
  };

  packUnits.push(created);
  return created;
}

export function updateSupplierProductPackUnit(supplierProductId: string,
  packUnitId: string,
  input: SupplierProductPackUnitUpdateInput, storeId: string) {
  getSupplierProductById(supplierProductId, storeId);
  const packUnit = findPackUnit(supplierProductId, packUnitId);

  if (input.isDefault === true) {
    for (const item of packUnits) {
      if (item.supplierProductId === supplierProductId) {
        item.isDefault = item.id === packUnitId;
      }
    }
  }

  if (input.label !== undefined) packUnit.label = input.label.trim();
  if (input.unitsPerPack !== undefined) packUnit.unitsPerPack = input.unitsPerPack;
  if (input.isDefault !== undefined) packUnit.isDefault = input.isDefault;
  if (input.isActive !== undefined) {
    packUnit.isActive = input.isActive;
    if (!input.isActive) {
      packUnit.isDefault = false;
    }
  }

  return { ...packUnit, isActive: packUnit.isActive ?? true, isDefault: packUnit.isDefault ?? false };
}

export function deactivateSupplierProductPackUnit(supplierProductId: string, packUnitId: string, storeId: string) {
  return updateSupplierProductPackUnit(supplierProductId, packUnitId, {
    isActive: false,
    isDefault: false,
  }, storeId);
}

export type SupplierProductInput = SupplierProductCreateInput;
