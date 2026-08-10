import type {
  ProductMock,
  ProductPackConversionMock,
  ProductPackConversionSummary,
} from "@/shared/mocks/erp-data";

export function buildPackConversionSummary(params: {
  link: ProductPackConversionMock;
  packProduct: ProductMock;
  productId: string;
  unitProduct: ProductMock;
}): ProductPackConversionSummary {
  const isPack = params.link.packProductId === params.productId;
  const linked = isPack ? params.unitProduct : params.packProduct;

  return {
    id: params.link.id,
    role: isPack ? "pack" : "unit",
    unitsPerPack: params.link.unitsPerPack,
    linkedProduct: {
      currentCostRef: linked.currentCostRef,
      currentStock: linked.currentStock,
      id: linked.id,
      name: linked.name,
      salePriceRef: linked.salePriceRef,
      sku: linked.sku,
    },
  };
}
