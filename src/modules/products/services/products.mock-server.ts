import { ApiError } from "@/lib/api/apiError";
import { assertMockStoreResource } from "@/lib/api/assertStoreResource";
import { paginateList } from "@/lib/api/pagination";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";
import {
  mockCategories,
  mockProductPriceHistory,
  mockProducts,
  type ProductPriceHistoryMock,
  type ProductMock,
} from "@/shared/mocks/erp-data";

import { parseProductSort, sortProductItems } from "./productSort";
import { matchesProductSearch, matchesExactBarcode, normalizeBarcode } from "./productSearch";
import { normalizeOptionalSku, normalizeSku } from "@/shared/utils/skuGeneration";

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
>;

export type ProductPriceInput = Pick<ProductMock, "salePriceRef">;

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

  const items = products.map((product) => ({
    ...product,
    category: mockCategories.find((category) => category.id === product.categoryId),
  }));

  const { sortBy, sortOrder } = parseProductSort(searchParams);
  const sortedItems = sortProductItems(items, sortBy, sortOrder);

  return paginateList(sortedItems, searchParams);
}

export function getProductById(id: string, storeId: string) {
  const product = mockProducts.find((item) => item.id === id);
  assertMockStoreResource(product, storeId, "Producto no encontrado.");

  return {
    ...product,
    category: mockCategories.find((category) => category.id === product.categoryId),
  };
}

export function createProduct(input: ProductInput, storeId: string) {
  const sku = normalizeSku(input.sku ?? `mock-${Date.now()}`);

  if (mockProducts.some((product) => product.sku === sku)) {
    throw new ApiError(409, "CONFLICT", "Ya existe un producto con este SKU.");
  }

  return {
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
  } satisfies ProductMock;
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
