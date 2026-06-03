import { ApiError } from "@/lib/api/apiError";
import { paginateList } from "@/lib/api/pagination";
import {
  mockContacts,
  mockProducts,
  mockSupplierProducts,
  type SupplierProductMock,
} from "@/shared/mocks/erp-data";

export type SupplierProductInput = Partial<
  Pick<SupplierProductMock, "lastCostRef" | "productId" | "supplierId" | "supplierSku">
>;

function enrichSupplierProduct(relation: SupplierProductMock) {
  return {
    ...relation,
    product: mockProducts.find((product) => product.id === relation.productId),
    supplier: mockContacts.find((contact) => contact.id === relation.supplierId),
  };
}

export function listSupplierProducts(searchParams: URLSearchParams) {
  const productId = searchParams.get("productId");
  const supplierId = searchParams.get("supplierId");

  const items = mockSupplierProducts
    .filter((relation) => {
      return (
        (!productId || relation.productId === productId) &&
        (!supplierId || relation.supplierId === supplierId)
      );
    })
    .map(enrichSupplierProduct);

  return paginateList(items, searchParams);
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
  const relation = mockSupplierProducts.find((item) => item.id === id);

  if (!relation) {
    throw new ApiError(404, "NOT_FOUND", "Relacion proveedor-producto no encontrada.");
  }

  return enrichSupplierProduct(relation);
}

export function createSupplierProduct(input: SupplierProductInput) {
  return enrichSupplierProduct({
    id: `supp-prod-mock-${Date.now()}`,
    lastCostRef: input.lastCostRef ?? 0,
    productId: input.productId ?? "prod-cable",
    supplierId: input.supplierId ?? "cont-supplier",
    supplierSku: input.supplierSku,
  });
}

export function updateSupplierProduct(id: string, input: SupplierProductInput) {
  const relation = getSupplierProductById(id);

  return {
    ...relation,
    ...input,
  };
}
