import { ApiError } from "@/lib/api/apiError";
import { paginateList } from "@/lib/api/pagination";
import {
  mockCategories,
  mockProductPriceHistory,
  mockProducts,
  type ProductPriceHistoryMock,
  type ProductMock,
} from "@/shared/mocks/erp-data";

export type ProductInput = Partial<
  Pick<
    ProductMock,
    | "categoryId"
    | "currentCostRef"
    | "currentStock"
    | "isActive"
    | "minStock"
    | "name"
    | "salePriceRef"
    | "sku"
  >
>;

export type ProductPriceInput = Pick<ProductMock, "salePriceRef">;

export function listProducts(searchParams: URLSearchParams) {
  const categoryId = searchParams.get("categoryId");
  const isActive = searchParams.get("isActive");
  const search = searchParams.get("search")?.toLowerCase();

  const products = mockProducts.filter((product) => {
    const matchesSearch =
      !search ||
      [product.name, product.sku].some((value) => value.toLowerCase().includes(search));
    const matchesCategory = !categoryId || product.categoryId === categoryId;
    const matchesActive =
      isActive === null || product.isActive === (isActive.toLowerCase() === "true");

    return matchesSearch && matchesCategory && matchesActive;
  });

  const items = products.map((product) => ({
    ...product,
    category: mockCategories.find((category) => category.id === product.categoryId),
  }));

  return paginateList(items, searchParams);
}

export function getProductById(id: string) {
  const product = mockProducts.find((item) => item.id === id);

  if (!product) {
    throw new ApiError(404, "NOT_FOUND", "Producto no encontrado.");
  }

  return {
    ...product,
    category: mockCategories.find((category) => category.id === product.categoryId),
  };
}

export function createProduct(input: ProductInput) {
  if (input.sku && mockProducts.some((product) => product.sku === input.sku)) {
    throw new ApiError(409, "CONFLICT", "Ya existe un producto con este SKU.");
  }

  return {
    categoryId: input.categoryId ?? "cat-tools",
    currentCostRef: input.currentCostRef ?? 0,
    currentStock: input.currentStock ?? 0,
    id: `prod-mock-${Date.now()}`,
    isActive: true,
    minStock: input.minStock ?? 5,
    name: input.name ?? "Producto mock",
    salePriceRef: input.salePriceRef ?? 0,
    sku: input.sku ?? `MOCK-${Date.now()}`,
  } satisfies ProductMock;
}

export function updateProduct(id: string, input: ProductInput) {
  if (
    input.sku &&
    mockProducts.some((product) => product.id !== id && product.sku === input.sku)
  ) {
    throw new ApiError(409, "CONFLICT", "Ya existe un producto con este SKU.");
  }

  return {
    ...getProductById(id),
    ...input,
  };
}

export function updateProductPrice(id: string, input: ProductPriceInput) {
  const product = getProductById(id);

  return {
    ...product,
    salePriceRef: input.salePriceRef,
  };
}

export function deleteProduct(id: string) {
  const product = getProductById(id);

  return {
    ...product,
    deleted: true,
  };
}

export function getProductPriceHistory(id: string, searchParams: URLSearchParams) {
  getProductById(id);

  const history = mockProductPriceHistory.filter((item) => item.productId === id);

  return paginateList(history, searchParams);
}

export function createProductPriceHistoryEntry(id: string, input: ProductPriceInput) {
  getProductById(id);

  return {
    createdAt: new Date().toISOString(),
    id: `price-mock-${Date.now()}`,
    productId: id,
    salePriceRef: input.salePriceRef,
    userId: "user-demo",
  } satisfies ProductPriceHistoryMock;
}
