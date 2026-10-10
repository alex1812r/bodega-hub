import type { ContactType, PurchaseStatus, SaleStatus } from "@/shared/mocks/erp-data";
import type { Permission } from "@/shared/auth/permissions";

/** Con menos caracteres no se consulta: la respuesta son los grupos vacíos. */
export const GLOBAL_SEARCH_MIN_LENGTH = 2;

/** Largo máximo de `q` ya recortado; por encima el BFF responde 400. */
export const GLOBAL_SEARCH_MAX_LENGTH = 80;

/** Resultados por tipo. */
export const GLOBAL_SEARCH_LIMIT = 5;

export type GlobalSearchGroup = "contacts" | "products" | "purchases" | "sales";

/** Permiso de lectura que habilita cada tipo de resultado. */
export const globalSearchPermissions: Record<GlobalSearchGroup, Permission> = {
  contacts: "contacts.view",
  products: "products.view",
  purchases: "purchases.view",
  sales: "sales.view",
};

export type GlobalSearchProduct = {
  barcode: string | null;
  id: string;
  name: string;
  sku: string;
};

export type GlobalSearchSale = {
  createdAt: string;
  customerName: string | null;
  id: string;
  number: string;
  status: SaleStatus;
  totalRef: number;
};

export type GlobalSearchPurchase = {
  createdAt: string;
  id: string;
  number: string;
  status: PurchaseStatus;
  supplierName: string | null;
  totalRef: number;
};

export type GlobalSearchContact = {
  id: string;
  name: string;
  taxId: string | null;
  type: ContactType;
};

export type GlobalSearchResults = {
  contacts: GlobalSearchContact[];
  products: GlobalSearchProduct[];
  purchases: GlobalSearchPurchase[];
  sales: GlobalSearchSale[];
};

/** Tipos que el rol puede ver; lo decide la ruta con los permisos de la sesión. */
export type GlobalSearchScopes = Record<GlobalSearchGroup, boolean> & {
  /** Vendedor: solo contactos de tipo exacto `cliente`, como en su listado. */
  customersOnly: boolean;
};

export type GlobalSearchInput = {
  /** Término ya normalizado por `normalizeGlobalSearchQuery`. */
  query: string;
  scopes: GlobalSearchScopes;
  /** Siempre de la sesión, nunca del cliente. */
  storeId: string;
};

export function emptyGlobalSearchResults(): GlobalSearchResults {
  return { contacts: [], products: [], purchases: [], sales: [] };
}
