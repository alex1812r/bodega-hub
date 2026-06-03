export type E2eManifest = {
  startedAt: string;
  finishedAt?: string;
  baseUrl: string;
  categoryIds: Record<string, string>;
  productIds: Record<string, string>;
  contactIds: Record<string, string>;
  supplierProductIds: string[];
  exchangeRateIds: string[];
  purchaseIds: Record<string, string> & { pay_patch_target?: string };
  saleIds: Record<string, string>;
  paymentIds: string[];
  discardCategoryId?: string;
  discardProductId?: string;
  vendedorUserId: string;
};

export function createEmptyManifest(baseUrl: string): E2eManifest {
  return {
    startedAt: new Date().toISOString(),
    baseUrl,
    categoryIds: {},
    productIds: {},
    contactIds: {},
    supplierProductIds: [],
    exchangeRateIds: [],
    purchaseIds: {},
    saleIds: {},
    paymentIds: [],
    vendedorUserId: "22222222-2222-4222-8222-222222222222",
  };
}
