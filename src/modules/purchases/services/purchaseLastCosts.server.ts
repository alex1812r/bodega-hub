import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import type { PurchaseLastCost, PurchaseLastCostsQuery } from "./purchaseLastCosts.mock-server";

/**
 * Cada producto con SU línea de compra recibida más reciente: `purchase_items` se
 * embebe con límite 1 por producto y ordenado por la fecha de creación de su compra.
 */
const LAST_LINE_SELECT = "id, purchase_items(unit_cost_ref, tax_rate, purchases!inner(created_at))";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type DbLastLineRow = {
  id: string;
  purchase_items: Array<{ tax_rate: number | string | null; unit_cost_ref: number | string }> | null;
};

/**
 * Una consulta para todos los `productIds`: la última línea recibida de cada uno, de
 * `supplierId` o, sin él, de cualquier proveedor. Con la sesión del usuario (RLS por tienda).
 */
async function readLastLines(
  productIds: string[],
  storeId: string,
  source: PurchaseLastCost["source"],
  supplierId?: string,
): Promise<PurchaseLastCost[]> {
  const supabase = await createRouteSupabaseClient();
  let query = supabase
    .from("products")
    .select(LAST_LINE_SELECT)
    .eq("store_id", storeId)
    .in("id", productIds)
    .eq("purchase_items.purchases.store_id", storeId)
    // Solo recibidas: ni pedidos sin recibir, ni anuladas (`cancelado`), ni devueltas (`devuelto`).
    .eq("purchase_items.purchases.status", "recibido");

  if (supplierId) {
    query = query.eq("purchase_items.purchases.supplier_id", supplierId);
  }

  const { data, error } = await query
    .order("purchases(created_at)", { ascending: false, referencedTable: "purchase_items" })
    .limit(1, { referencedTable: "purchase_items" });

  throwIfSupabaseError(error);

  return ((data ?? []) as DbLastLineRow[]).flatMap((row): PurchaseLastCost[] => {
    const line = row.purchase_items?.[0];

    return line
      ? [
          {
            productId: row.id,
            source,
            taxRate: Number(line.tax_rate ?? 0),
            unitCostRef: Number(line.unit_cost_ref),
          },
        ]
      : [];
  });
}

/**
 * Último costo de compra de cada producto pedido: primero entre las compras recibidas de
 * `supplierId`; para los que ese proveedor nunca vendió, entre las de cualquier proveedor.
 * Un producto sin ninguna línea recibida no aparece. Dos consultas como mucho.
 */
export async function listPurchaseLastCosts(
  { productIds, supplierId }: PurchaseLastCostsQuery,
  storeId: string,
): Promise<PurchaseLastCost[]> {
  // `products.id` y `contacts.id` son uuid: otro texto no puede existir (y Postgres lo rechazaría).
  const ids = [...new Set(productIds)].filter((id) => UUID_PATTERN.test(id));

  if (ids.length === 0) {
    return [];
  }

  const fromSupplier = UUID_PATTERN.test(supplierId)
    ? await readLastLines(ids, storeId, "supplier", supplierId)
    : [];
  const found = new Set(fromSupplier.map((cost) => cost.productId));
  const missing = ids.filter((id) => !found.has(id));
  const fromAny = missing.length > 0 ? await readLastLines(missing, storeId, "any") : [];

  return [...fromSupplier, ...fromAny];
}
