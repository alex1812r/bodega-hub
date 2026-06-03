import { ApiError } from "@/lib/api/apiError";
import { paginateList } from "@/lib/api/pagination";
import { mockProducts, mockStockMovements, type StockMovementType } from "@/shared/mocks/erp-data";

export function listInventory(searchParams: URLSearchParams) {
  const onlyLowStock = searchParams.get("lowStock") === "true";
  const search = searchParams.get("search")?.toLowerCase();

  const items = mockProducts.filter((product) => {
    const matchesLowStock = !onlyLowStock || product.currentStock <= product.minStock;
    const matchesSearch =
      !search ||
      product.name.toLowerCase().includes(search) ||
      product.sku.toLowerCase().includes(search);

    return matchesLowStock && matchesSearch;
  });

  return paginateList(items, searchParams);
}

export function listStockMovements(searchParams: URLSearchParams) {
  const productId = searchParams.get("productId");

  const items = mockStockMovements
    .filter((movement) => !productId || movement.productId === productId)
    .map((movement) => ({
      ...movement,
      product: mockProducts.find((product) => product.id === movement.productId),
    }));

  return paginateList(items, searchParams);
}

export function getStockCard(searchParams: URLSearchParams) {
  return listStockMovements(searchParams);
}

export function createStockAdjustment(input: {
  productId: string;
  quantityDelta: number;
  reason?: string;
  type?: StockMovementType;
}) {
  const product = mockProducts.find((item) => item.id === input.productId);
  const stockAfter = (product?.currentStock ?? 0) + input.quantityDelta;

  if (!product) {
    throw new ApiError(404, "NOT_FOUND", "Producto no encontrado.");
  }

  if (stockAfter < 0) {
    throw new ApiError(400, "BAD_REQUEST", "El ajuste no puede dejar stock negativo.");
  }

  return {
    createdAt: new Date().toISOString(),
    id: `mov-mock-${Date.now()}`,
    productId: input.productId,
    quantityDelta: input.quantityDelta,
    reason: input.reason,
    stockAfter,
    type: input.type ?? (input.quantityDelta >= 0 ? "ajuste_entrada" : "ajuste_salida"),
  };
}
