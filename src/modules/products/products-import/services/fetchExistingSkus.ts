import { apiFetch } from "@/shared/api/apiFetch";
import type { PaginatedList } from "@/lib/api/pagination";
import type { ProductMock } from "@/shared/mocks/erp-data";

const PAGE_LIMIT = 100;

export async function fetchExistingSkus(): Promise<Set<string>> {
  const skus = new Set<string>();
  let skip = 0;
  let total = Infinity;

  while (skip < total) {
    const page = await apiFetch<PaginatedList<Pick<ProductMock, "sku">>>("/api/products", {
      query: { limit: PAGE_LIMIT, skip },
    });

    page.items.forEach((product) => {
      if (product.sku) {
        skus.add(product.sku.toLowerCase());
      }
    });

    total = page.total;
    skip += page.limit;

    if (page.items.length === 0) {
      break;
    }
  }

  return skus;
}
