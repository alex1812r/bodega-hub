import { mockEntityStoreId } from "@/lib/api/assertStoreResource";
import { matchesProductSearch } from "@/modules/products/services/productSearch";
import { mockContacts, mockProducts, mockPurchases, mockSales } from "@/shared/mocks/erp-data";

import {
  GLOBAL_SEARCH_LIMIT,
  type GlobalSearchInput,
  type GlobalSearchResults,
} from "../types";
import { containsIgnoreCase, rankProducts } from "./searchQuery";

function byNewest(a: { createdAt: string }, b: { createdAt: string }) {
  return b.createdAt.localeCompare(a.createdAt);
}

/** Paridad con `search.server.ts` sobre los datos del mock; el id casa por igualdad exacta. */
export function searchStore({ query, scopes, storeId }: GlobalSearchInput): GlobalSearchResults {
  const inStore = (entity: { storeId?: string | null }) => mockEntityStoreId(entity) === storeId;
  const contactName = (id: string) =>
    mockContacts.find((contact) => contact.id === id && inStore(contact))?.name ?? null;

  const products = scopes.products
    ? rankProducts(
        mockProducts
          .filter(
            (product) =>
              inStore(product) && (product.id === query || matchesProductSearch(product, query)),
          )
          .map((product) => ({
            barcode: product.barcode ?? null,
            id: product.id,
            name: product.name,
            sku: product.sku,
          })),
        query,
      )
    : [];

  const sales = scopes.sales
    ? mockSales
        .filter(
          (sale) =>
            inStore(sale) && (sale.id === query || containsIgnoreCase(sale.invoiceNumber, query)),
        )
        .sort(byNewest)
        .slice(0, GLOBAL_SEARCH_LIMIT)
        .map((sale) => ({
          createdAt: sale.createdAt,
          customerName: contactName(sale.customerId),
          id: sale.id,
          number: sale.invoiceNumber,
          status: sale.status,
          totalRef: sale.totalRef,
        }))
    : [];

  const purchases = scopes.purchases
    ? mockPurchases
        .filter(
          (purchase) =>
            inStore(purchase) &&
            (purchase.id === query || containsIgnoreCase(purchase.purchaseNumber, query)),
        )
        .sort(byNewest)
        .slice(0, GLOBAL_SEARCH_LIMIT)
        .map((purchase) => ({
          createdAt: purchase.createdAt,
          id: purchase.id,
          number: purchase.purchaseNumber,
          status: purchase.status,
          supplierName: contactName(purchase.supplierId),
          totalRef: purchase.totalRef,
        }))
    : [];

  const contacts = scopes.contacts
    ? mockContacts
        .filter(
          (contact) =>
            inStore(contact) &&
            (!scopes.customersOnly || contact.type === "cliente") &&
            (contact.id === query ||
              [contact.name, contact.taxId, contact.phone].some((value) =>
                containsIgnoreCase(value, query),
              )),
        )
        .sort((a, b) => a.name.localeCompare(b.name, "es"))
        .slice(0, GLOBAL_SEARCH_LIMIT)
        .map((contact) => ({
          id: contact.id,
          name: contact.name,
          taxId: contact.taxId || null,
          type: contact.type,
        }))
    : [];

  return { contacts, products, purchases, sales };
}
