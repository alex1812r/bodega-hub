import { ApiError } from "@/lib/api/apiError";
import { paginateList } from "@/lib/api/pagination";
import {
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

import { matchesProductSearch } from "@/modules/products/services/productSearch";
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

  return {
    ...relation,
    defaultPackUnit,
    isActive: relation.isActive ?? true,
    lastPriceOrigin: relation.lastPriceOrigin ?? latest[0]?.origin,
    packUnits: relationPackUnits,
    product: mockProducts.find((product) => product.id === relation.productId),
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

export function listSupplierProducts(searchParams: URLSearchParams) {
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

export function listProductSuppliers(productId: string, searchParams: URLSearchParams) {
  const params = new URLSearchParams(searchParams);
  params.set("productId", productId);

  return listSupplierProducts(params);
}

export function listSupplierProductsBySupplier(supplierId: string, searchParams: URLSearchParams) {
  const params = new URLSearchParams(searchParams);
  params.set("supplierId", supplierId);

  return listSupplierProducts(params);
}

export function getSupplierProductById(id: string) {
  return enrichSupplierProduct(findRelation(id));
}

export function createSupplierProduct(input: SupplierProductCreateInput) {
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

    applyInitialPrice(existing, input, () => {
      existing.isActive = false;
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
    supplierId: input.supplierId,
    supplierSku: normalizeOptionalSku(input.supplierSku) ?? undefined,
    updatedAt: now,
    variationPercent: null,
  };

  supplierProducts.unshift(relation);

  applyInitialPrice(relation, input, () => {
    const index = supplierProducts.indexOf(relation);
    if (index >= 0) {
      supplierProducts.splice(index, 1);
    }
  });

  return enrichSupplierProduct(relation);
}

export function updateSupplierProduct(id: string, input: SupplierProductMetadataUpdateInput) {
  const relation = findRelation(id);

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

  return enrichSupplierProduct(relation);
}

export function registerSupplierProductPrice(
  id: string,
  input: SupplierProductRegisterPriceInput,
) {
  const relation = findRelation(id);

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

export function deactivateSupplierProduct(id: string) {
  const relation = findRelation(id);
  relation.isActive = false;
  relation.updatedAt = new Date().toISOString();

  return enrichSupplierProduct(relation);
}

export function listSupplierProductPriceHistory(id: string, searchParams: URLSearchParams) {
  findRelation(id);

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

export function listSupplierProductPackUnits(supplierProductId: string) {
  findRelation(supplierProductId);

  return packUnits
    .filter((item) => item.supplierProductId === supplierProductId)
    .map((item) => ({ ...item, isActive: item.isActive ?? true, isDefault: item.isDefault ?? false }));
}

export function createSupplierProductPackUnit(
  supplierProductId: string,
  input: SupplierProductPackUnitInput,
) {
  findRelation(supplierProductId);

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

export function updateSupplierProductPackUnit(
  supplierProductId: string,
  packUnitId: string,
  input: SupplierProductPackUnitUpdateInput,
) {
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

export function deactivateSupplierProductPackUnit(supplierProductId: string, packUnitId: string) {
  return updateSupplierProductPackUnit(supplierProductId, packUnitId, {
    isActive: false,
    isDefault: false,
  });
}

export type SupplierProductInput = SupplierProductCreateInput;
