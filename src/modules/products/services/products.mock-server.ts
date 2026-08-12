import { ApiError } from "@/lib/api/apiError";
import { assertMockStoreResource } from "@/lib/api/assertStoreResource";
import { paginateList } from "@/lib/api/pagination";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";
import {
  mockCategories,
  mockProductPackConversions,
  mockProductPriceHistory,
  mockProducts,
  type ProductPriceHistoryMock,
  type ProductMock,
} from "@/shared/mocks/erp-data";
import { generateProductSkuFromName, normalizeSku } from "@/shared/utils/skuGeneration";

import type { PackConversionInput } from "./packConversionSchemas";
import { buildPackConversionSummary } from "./packConversionSummary";
import { parseProductSort, sortProductItems } from "./productSort";
import { matchesProductSearch, matchesExactBarcode, normalizeBarcode } from "./productSearch";

export type ProductInput = Partial<
  Pick<
    ProductMock,
    | "barcode"
    | "categoryId"
    | "currentCostRef"
    | "currentStock"
    | "imageUrl"
    | "isActive"
    | "minStock"
    | "name"
    | "salePriceRef"
    | "sku"
  >
> & {
  packConversion?: PackConversionInput;
};

export type ProductPriceInput = Pick<ProductMock, "salePriceRef">;

function resolvePackConversion(productId: string, storeId: string) {
  const link = mockProductPackConversions.find(
    (item) =>
      item.isActive &&
      item.storeId === storeId &&
      (item.packProductId === productId || item.unitProductId === productId),
  );

  if (!link) {
    return undefined;
  }

  const packProduct = mockProducts.find((item) => item.id === link.packProductId);
  const unitProduct = mockProducts.find((item) => item.id === link.unitProductId);

  if (!packProduct || !unitProduct) {
    return undefined;
  }

  return buildPackConversionSummary({
    link,
    packProduct,
    productId,
    unitProduct,
  });
}

function upsertMockPackConversion(
  packProductId: string,
  storeId: string,
  input: PackConversionInput,
  packProduct: ProductMock,
) {
  if (!input.enabled) {
    for (const link of mockProductPackConversions) {
      if (link.packProductId === packProductId && link.storeId === storeId) {
        link.isActive = false;
      }
    }
    return;
  }

  const unitsPerPack = input.unitsPerPack ?? 2;
  let unitProductId = input.unitProductId;

  if (input.mode === "link_existing") {
    if (!unitProductId) {
      throw new ApiError(400, "BAD_REQUEST", "Selecciona el producto unidad.");
    }

    const unit = mockProducts.find((item) => item.id === unitProductId);
    assertMockStoreResource(unit, storeId, "Producto unidad no encontrado.");

    if (unitProductId === packProductId) {
      throw new ApiError(400, "BAD_REQUEST", "El empaque y la unidad deben ser productos distintos.");
    }

    const conflict = mockProductPackConversions.find(
      (item) =>
        item.isActive &&
        item.storeId === storeId &&
        (item.packProductId === unitProductId || item.unitProductId === unitProductId) &&
        item.packProductId !== packProductId,
    );

    if (conflict) {
      throw new ApiError(409, "CONFLICT", "El producto unidad ya esta vinculado a otro empaque.");
    }
  } else {
    const unitName = input.unitProduct?.name?.trim() || `${packProduct.name} (unidad)`;
    const unitSku =
      normalizeSku(input.unitProduct?.sku ?? "") || generateProductSkuFromName(unitName);
    const unitCost =
      input.unitProduct?.currentCostRef ??
      Number(((packProduct.currentCostRef ?? 0) / unitsPerPack).toFixed(2));

    if (mockProducts.some((product) => product.sku === unitSku)) {
      throw new ApiError(409, "CONFLICT", "Ya existe un producto con este SKU de unidad.");
    }

    const unitProduct: ProductMock = {
      barcode: normalizeBarcode(input.unitProduct?.barcode),
      categoryId: packProduct.categoryId,
      currentCostRef: unitCost,
      currentStock: 0,
      id: `prod-unit-${Date.now()}`,
      isActive: true,
      minStock: 5,
      name: unitName,
      salePriceRef: input.unitProduct?.salePriceRef ?? 0,
      sku: unitSku,
      storeId,
    };
    mockProducts.push(unitProduct);
    unitProductId = unitProduct.id;
  }

  const existing = mockProductPackConversions.find(
    (item) => item.packProductId === packProductId && item.storeId === storeId && item.isActive,
  );

  if (existing) {
    existing.unitProductId = unitProductId!;
    existing.unitsPerPack = unitsPerPack;
    return;
  }

  mockProductPackConversions.push({
    id: `ppc-${Date.now()}`,
    isActive: true,
    packProductId,
    storeId,
    unitProductId: unitProductId!,
    unitsPerPack,
  });
}

export function listProducts(searchParams: URLSearchParams, storeId: string) {
  const barcode = normalizeBarcode(searchParams.get("barcode"));
  const categoryId = searchParams.get("categoryId");
  const isActive = searchParams.get("isActive");
  const search = searchParams.get("search")?.toLowerCase();

  const products = mockProducts.filter((product) => {
    const matchesBarcode = !barcode || matchesExactBarcode(product, barcode);
    const matchesSearch = barcode || !search || matchesProductSearch(product, search);
    const matchesCategory = !categoryId || product.categoryId === categoryId;
    const matchesActive =
      isActive === null || product.isActive === (isActive.toLowerCase() === "true");

    return (
      (product.storeId ?? DEFAULT_STORE_ID) === storeId &&
      matchesBarcode &&
      matchesSearch &&
      matchesCategory &&
      matchesActive
    );
  });

  const items = products.map((product) => {
    const category = mockCategories.find((item) => item.id === product.categoryId);
    return {
      ...product,
      category,
      taxRate: product.taxRate ?? category?.taxRate ?? 0,
    };
  });

  const { sortBy, sortOrder } = parseProductSort(searchParams);
  const sortedItems = sortProductItems(items, sortBy, sortOrder);

  return paginateList(sortedItems, searchParams);
}

export function getProductById(id: string, storeId: string) {
  const product = mockProducts.find((item) => item.id === id);
  assertMockStoreResource(product, storeId, "Producto no encontrado.");

  const packConversion = resolvePackConversion(id, storeId);

  return {
    ...product,
    category: mockCategories.find((category) => category.id === product.categoryId),
    ...(packConversion ? { packConversion } : {}),
  };
}

export function createProduct(input: ProductInput, storeId: string) {
  const sku = normalizeSku(input.sku ?? `mock-${Date.now()}`);

  if (mockProducts.some((product) => product.sku === sku)) {
    throw new ApiError(409, "CONFLICT", "Ya existe un producto con este SKU.");
  }

  const product: ProductMock = {
    barcode: normalizeBarcode(input.barcode),
    categoryId: input.categoryId ?? "cat-tools",
    currentCostRef: input.currentCostRef ?? 0,
    currentStock: input.currentStock ?? 0,
    id: `prod-mock-${Date.now()}`,
    imageUrl: input.imageUrl ?? undefined,
    isActive: true,
    minStock: input.minStock ?? 5,
    name: input.name ?? "Producto mock",
    salePriceRef: input.salePriceRef ?? 0,
    sku,
    storeId,
  };

  mockProducts.push(product);

  if (input.packConversion) {
    upsertMockPackConversion(product.id, storeId, input.packConversion, product);
  }

  return getProductById(product.id, storeId);
}

export function updateProduct(id: string, input: ProductInput, storeId: string) {
  if (input.sku) {
    const sku = normalizeSku(input.sku);

    if (mockProducts.some((product) => product.id !== id && product.sku === sku)) {
      throw new ApiError(409, "CONFLICT", "Ya existe un producto con este SKU.");
    }
  }

  const product = mockProducts.find((item) => item.id === id);
  assertMockStoreResource(product, storeId, "Producto no encontrado.");

  if (input.barcode !== undefined) product.barcode = normalizeBarcode(input.barcode);
  if (input.categoryId !== undefined) product.categoryId = input.categoryId;
  if (input.currentCostRef !== undefined) product.currentCostRef = input.currentCostRef;
  if (input.currentStock !== undefined) product.currentStock = input.currentStock;
  if (input.imageUrl !== undefined) product.imageUrl = input.imageUrl ?? undefined;
  if (input.isActive !== undefined) product.isActive = input.isActive;
  if (input.minStock !== undefined) product.minStock = input.minStock;
  if (input.name !== undefined) product.name = input.name;
  if (input.salePriceRef !== undefined) product.salePriceRef = input.salePriceRef;
  if (input.sku !== undefined) product.sku = normalizeSku(input.sku);

  if (input.packConversion) {
    upsertMockPackConversion(id, storeId, input.packConversion, product);
  }

  return getProductById(id, storeId);
}

export function updateProductPrice(id: string, input: ProductPriceInput, storeId: string) {
  const product = getProductById(id, storeId);

  return {
    ...product,
    salePriceRef: input.salePriceRef,
  };
}

export function deleteProduct(id: string, storeId: string) {
  const product = mockProducts.find((item) => item.id === id);
  assertMockStoreResource(product, storeId, "Producto no encontrado.");

  if (product.isActive === false) {
    throw new ApiError(404, "NOT_FOUND", "Producto no encontrado.");
  }

  product.isActive = false;

  return {
    ...getProductById(id, storeId),
    deleted: true,
  };
}

export function getProductPriceHistory(id: string, searchParams: URLSearchParams, storeId: string) {
  getProductById(id, storeId);

  const history = mockProductPriceHistory.filter((item) => item.productId === id);

  return paginateList(history, searchParams);
}

export function createProductPriceHistoryEntry(id: string, input: ProductPriceInput, storeId: string) {
  getProductById(id, storeId);

  return {
    createdAt: new Date().toISOString(),
    id: `price-mock-${Date.now()}`,
    productId: id,
    salePriceRef: input.salePriceRef,
    userId: "user-demo",
  } satisfies ProductPriceHistoryMock;
}

export function listPackConversions(storeId: string) {
  return mockProductPackConversions
    .filter((item) => item.isActive && item.storeId === storeId)
    .map((link) => {
      const packProduct = mockProducts.find((item) => item.id === link.packProductId);
      const unitProduct = mockProducts.find((item) => item.id === link.unitProductId);

      if (!packProduct || !unitProduct) {
        return null;
      }

      const summary = buildPackConversionSummary({
        link,
        packProduct,
        productId: link.packProductId,
        unitProduct,
      });

      return {
        ...summary,
        packProduct: {
          currentCostRef: packProduct.currentCostRef,
          currentStock: packProduct.currentStock,
          id: packProduct.id,
          name: packProduct.name,
          salePriceRef: packProduct.salePriceRef,
          sku: packProduct.sku,
        },
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}
