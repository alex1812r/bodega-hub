import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { buildProductSearchOrFilter } from "@/modules/products/services/productSearch";
import type { ContactType, PurchaseStatus, SaleStatus } from "@/shared/mocks/erp-data";

import {
  GLOBAL_SEARCH_LIMIT,
  type GlobalSearchContact,
  type GlobalSearchInput,
  type GlobalSearchProduct,
  type GlobalSearchPurchase,
  type GlobalSearchResults,
  type GlobalSearchSale,
} from "../types";
import { buildSearchOrFilter, quotedIlikePattern, rankProducts, toSearchUuid } from "./searchQuery";

type RouteSupabaseClient = Awaited<ReturnType<typeof createRouteSupabaseClient>>;

type ProductRow = {
  barcode: string | null;
  id: string;
  name: string;
  sku: string;
};

type RelatedContact = { name: string | null } | null;

type SaleRow = {
  created_at: string;
  customer: RelatedContact;
  id: string;
  invoice_number: string;
  status: SaleStatus;
  total_ref: number | string;
};

type PurchaseRow = {
  created_at: string;
  id: string;
  purchase_number: string;
  status: PurchaseStatus;
  supplier: RelatedContact;
  total_ref: number | string;
};

type ContactRow = {
  id: string;
  name: string;
  tax_id: string | null;
  type: ContactType;
};

const PRODUCT_SELECT = "id, name, sku, barcode";

/**
 * Dos lecturas: la de coincidencias fuertes (código de barras exacto, SKU por
 * prefijo, id) y la general por nombre, SKU o código. Así un código exacto no se
 * pierde detrás de los cinco primeros nombres que contienen el mismo texto.
 */
async function searchProducts(
  supabase: RouteSupabaseClient,
  { query, storeId }: GlobalSearchInput,
): Promise<GlobalSearchProduct[]> {
  const uuid = toSearchUuid(query);
  const strongFilter = [
    `barcode.ilike.${quotedIlikePattern(query, "exact")}`,
    `sku.ilike.${quotedIlikePattern(query, "prefix")}`,
    ...(uuid ? [`id.eq.${uuid}`] : []),
  ].join(",");

  const [strong, broad] = await Promise.all([
    supabase
      .from("products")
      .select(PRODUCT_SELECT)
      .eq("store_id", storeId)
      .or(strongFilter)
      .order("sku")
      .limit(GLOBAL_SEARCH_LIMIT * 2),
    supabase
      .from("products")
      .select(PRODUCT_SELECT)
      .eq("store_id", storeId)
      .or(buildProductSearchOrFilter(query))
      .order("name")
      .limit(GLOBAL_SEARCH_LIMIT),
  ]);

  throwIfSupabaseError(strong.error);
  throwIfSupabaseError(broad.error);

  const rows = [...((strong.data ?? []) as ProductRow[]), ...((broad.data ?? []) as ProductRow[])];

  return rankProducts(
    rows.map((row) => ({ barcode: row.barcode, id: row.id, name: row.name, sku: row.sku })),
    query,
  );
}

async function searchSales(
  supabase: RouteSupabaseClient,
  { query, storeId }: GlobalSearchInput,
): Promise<GlobalSearchSale[]> {
  const { data, error } = await supabase
    .from("sales")
    .select(
      "id, invoice_number, status, total_ref, created_at, customer:contacts!sales_customer_id_fkey(name)",
    )
    .eq("store_id", storeId)
    .or(buildSearchOrFilter(["invoice_number"], query))
    .order("created_at", { ascending: false })
    .limit(GLOBAL_SEARCH_LIMIT);

  throwIfSupabaseError(error);

  return ((data ?? []) as unknown as SaleRow[]).map((row) => ({
    createdAt: row.created_at,
    customerName: row.customer?.name ?? null,
    id: row.id,
    number: row.invoice_number,
    status: row.status,
    totalRef: Number(row.total_ref),
  }));
}

async function searchPurchases(
  supabase: RouteSupabaseClient,
  { query, storeId }: GlobalSearchInput,
): Promise<GlobalSearchPurchase[]> {
  const { data, error } = await supabase
    .from("purchases")
    .select("id, purchase_number, status, total_ref, created_at, supplier:contacts(name)")
    .eq("store_id", storeId)
    .or(buildSearchOrFilter(["purchase_number"], query))
    .order("created_at", { ascending: false })
    .limit(GLOBAL_SEARCH_LIMIT);

  throwIfSupabaseError(error);

  return ((data ?? []) as unknown as PurchaseRow[]).map((row) => ({
    createdAt: row.created_at,
    id: row.id,
    number: row.purchase_number,
    status: row.status,
    supplierName: row.supplier?.name ?? null,
    totalRef: Number(row.total_ref),
  }));
}

async function searchContacts(
  supabase: RouteSupabaseClient,
  { query, scopes, storeId }: GlobalSearchInput,
): Promise<GlobalSearchContact[]> {
  let request = supabase
    .from("contacts")
    .select("id, name, type, tax_id")
    .eq("store_id", storeId)
    .or(buildSearchOrFilter(["name", "tax_id", "phone"], query));

  if (scopes.customersOnly) {
    request = request.eq("type", "cliente");
  }

  const { data, error } = await request.order("name").limit(GLOBAL_SEARCH_LIMIT);

  throwIfSupabaseError(error);

  return ((data ?? []) as ContactRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    taxId: row.tax_id || null,
    type: row.type,
  }));
}

/**
 * Búsqueda global de la tienda: solo lectura, un tipo por permiso y las lecturas
 * en paralelo. Un tipo sin permiso no se consulta.
 */
export async function searchStore(input: GlobalSearchInput): Promise<GlobalSearchResults> {
  const supabase = await createRouteSupabaseClient();
  const { scopes } = input;

  const [contacts, products, purchases, sales] = await Promise.all([
    scopes.contacts ? searchContacts(supabase, input) : [],
    scopes.products ? searchProducts(supabase, input) : [],
    scopes.purchases ? searchPurchases(supabase, input) : [],
    scopes.sales ? searchSales(supabase, input) : [],
  ]);

  return { contacts, products, purchases, sales };
}
