import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api/apiError";
import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { assertImpactDocumentId } from "@/shared/impact/impactServer";
import type { PaymentMethod, PaymentStatus, PurchaseStatus } from "@/shared/mocks/erp-data";

import {
  computePurchaseImpact,
  type PurchaseImpactAction,
  type PurchaseImpactDisassembleEntry,
  type PurchaseImpactInputs,
  type PurchaseImpactRecipe,
} from "./purchaseImpact";

type ReadClient = Pick<SupabaseClient, "from">;

/**
 * Clientes de LECTURA del impact.
 *
 * - `user`: JWT de quien pide el impact. Con él se lee todo lo que la RLS
 *   alcanza por tienda (compra, líneas, productos, recetas, movimientos), y es
 *   quien decide el 404 de una compra ajena.
 * - `privileged`: service role, SOLO para los `payments` de la compra. Desde
 *   20261010c la RLS los oculta a almacén, pero `cancel_purchase` /
 *   `return_purchase` (security definer) los cuentan igual y rechazan si hay
 *   alguno activo: sin esta lectura el impact diría «permitido» y la RPC
 *   rechazaría. Va filtrada por `store_id` y por una compra ya validada; a quien
 *   no puede ver pagos de compras solo le llega el veredicto (lo mismo que dice
 *   el mensaje de la RPC), nunca las líneas (`canViewPayments`).
 */
export type PurchaseImpactClients = {
  privileged: () => ReadClient;
  user: ReadClient;
};

export type PurchaseImpactOptions = {
  /** Calculado por la ruta con el rol de la sesión (`canViewPurchasePayments`). */
  canViewPayments?: boolean;
  /** Solo `receive`: la lista `disassemble` que enviará la recepción; sin ella, las marcas guardadas. */
  disassemble?: PurchaseImpactDisassembleEntry[] | null;
};

type PurchaseRow = {
  id: string;
  purchase_items: Array<{
    disassemble_on_receive: boolean | null;
    disassembled_conversion_id: string | null;
    id: string;
    product_id: string;
    quantity: number;
    tax_rate: number | null;
    unit_cost_ref: number | null;
  }> | null;
  purchase_number: string;
  status: PurchaseStatus;
  supplier: { name: string } | null;
};

type ProductRow = {
  current_cost_ref: number | null;
  current_stock: number;
  id: string;
  is_active: boolean;
  name: string;
  sku: string | null;
};

type RecipeRow = {
  components: Array<{
    cost_weight: number;
    unit_product_id: string;
    units_per_pack: number;
  }> | null;
  id: string;
  pack_product_id: string;
  total_units: number;
};

type PaymentRow = {
  amount: number;
  amount_ref: number;
  amount_ves: number;
  created_at: string;
  currency: string;
  id: string;
  method: PaymentMethod;
  status: PaymentStatus | null;
};

const PURCHASE_NOT_FOUND = "Compra no encontrada.";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Los mismos rechazos de forma (PT400) de las RPC para una lista con ids que no son uuid. */
function assertDisassembleIds(disassemble: PurchaseImpactDisassembleEntry[] | null) {
  for (const entry of disassemble ?? []) {
    if (!UUID_PATTERN.test(entry.purchaseItemId)) {
      throw new ApiError(400, "BAD_REQUEST", "Cada linea a desarmar requiere purchase_item_id");
    }

    if (entry.distribution?.some((item) => !UUID_PATTERN.test(item.unitProductId))) {
      throw new ApiError(
        400,
        "BAD_REQUEST",
        "Cada componente de la distribucion requiere unit_product_id y units (entero mayor o igual a cero)",
      );
    }
  }
}

/** Recetas activas de los productos de un pedido: lo que la recepción va a abrir. */
async function loadRecipes(
  user: ReadClient,
  storeId: string,
  productIds: string[],
): Promise<PurchaseImpactRecipe[]> {
  if (productIds.length === 0) {
    return [];
  }

  const { data, error } = await user
    .from("product_pack_conversions")
    .select(
      "id, pack_product_id, total_units, components:product_pack_components(unit_product_id, units_per_pack, cost_weight)",
    )
    .eq("store_id", storeId)
    .eq("is_active", true)
    .in("pack_product_id", productIds)
    .returns<RecipeRow[]>();

  throwIfSupabaseError(error);

  return (data ?? []).map((row) => ({
    components: (row.components ?? []).map((component) => ({
      costWeight: Number(component.cost_weight),
      unitProductId: component.unit_product_id,
      unitsPerPack: Number(component.units_per_pack),
    })),
    conversionId: row.id,
    packProductId: row.pack_product_id,
    totalUnits: Number(row.total_units),
  }));
}

/**
 * Lee (solo `select`) lo que las RPC de recibir, cancelar y devolver van a
 * mirar. La compra de otra tienda o inexistente responde 404.
 */
export async function loadPurchaseImpactInputs(
  clients: PurchaseImpactClients,
  purchaseId: string,
  action: PurchaseImpactAction,
  storeId: string,
  options: PurchaseImpactOptions = {},
): Promise<PurchaseImpactInputs> {
  assertImpactDocumentId(purchaseId);

  const disassemble = action === "receive" ? (options.disassemble ?? null) : null;
  assertDisassembleIds(disassemble);

  const { data: purchase, error } = await clients.user
    .from("purchases")
    .select(
      "id, purchase_number, status, supplier:contacts(name), purchase_items(id, product_id, quantity, unit_cost_ref, tax_rate, disassemble_on_receive, disassembled_conversion_id)",
    )
    .eq("id", purchaseId)
    .eq("store_id", storeId)
    .maybeSingle<PurchaseRow>();

  throwIfSupabaseError(error);

  if (!purchase) {
    throw new ApiError(404, "NOT_FOUND", PURCHASE_NOT_FOUND);
  }

  const items = (purchase.purchase_items ?? []).map((item) => ({
    disassembled: Boolean(item.disassembled_conversion_id),
    disassembleOnReceive: item.disassemble_on_receive === true,
    id: item.id,
    productId: item.product_id,
    quantity: Number(item.quantity),
    taxRate: Number(item.tax_rate ?? 0),
    unitCostRef: Number(item.unit_cost_ref ?? 0),
  }));
  const purchasedIds = [...new Set(items.map((item) => item.productId))];
  const reverses = action !== "receive";

  const [recipes, returned, payments] = await Promise.all([
    // Solo un pedido se recibe: en otro estado la RPC rechaza antes de mirar recetas.
    action === "receive" && purchase.status === "pedido"
      ? loadRecipes(clients.user, storeId, purchasedIds)
      : [],
    reverses
      ? clients.user
          .from("stock_movements")
          .select("product_id, quantity_delta")
          .eq("purchase_id", purchaseId)
          .eq("type", "devolucion_proveedor")
          .returns<Array<{ product_id: string; quantity_delta: number }>>()
      : { data: [], error: null },
    reverses
      ? clients
          .privileged()
          .from("payments")
          .select("id, method, currency, amount, amount_ves, amount_ref, status, created_at")
          .eq("store_id", storeId)
          .eq("purchase_id", purchaseId)
          .returns<PaymentRow[]>()
      : { data: [], error: null },
  ]);

  throwIfSupabaseError(returned.error);
  throwIfSupabaseError(payments.error);

  const productIds = [
    ...new Set([
      ...purchasedIds,
      ...recipes.flatMap((recipe) => recipe.components.map((component) => component.unitProductId)),
    ]),
  ];
  const products =
    productIds.length > 0
      ? await clients.user
          .from("products")
          .select("id, name, sku, current_stock, current_cost_ref, is_active")
          .eq("store_id", storeId)
          .in("id", productIds)
          .returns<ProductRow[]>()
      : { data: [] as ProductRow[], error: null };

  throwIfSupabaseError(products.error);

  const returnedByProduct: Record<string, number> = {};
  for (const movement of returned.data ?? []) {
    returnedByProduct[movement.product_id] =
      (returnedByProduct[movement.product_id] ?? 0) - Number(movement.quantity_delta);
  }

  return {
    action,
    canViewPayments: options.canViewPayments ?? true,
    disassemble,
    items,
    payments: (payments.data ?? []).map((payment) => ({
      amount: Number(payment.amount),
      amountRef: Number(payment.amount_ref),
      amountVes: Number(payment.amount_ves),
      createdAt: payment.created_at,
      currency: payment.currency === "USD" ? ("USD" as const) : ("VES" as const),
      id: payment.id,
      method: payment.method,
      status: payment.status ?? ("activo" as const),
    })),
    products: (products.data ?? []).map((product) => ({
      currentCostRef: product.current_cost_ref === null ? null : Number(product.current_cost_ref),
      currentStock: Number(product.current_stock),
      id: product.id,
      isActive: product.is_active,
      name: product.name,
      sku: product.sku,
    })),
    purchase: {
      id: purchase.id,
      purchaseNumber: purchase.purchase_number,
      status: purchase.status,
      supplierName: purchase.supplier?.name ?? null,
    },
    recipes,
    returnedByProduct,
  };
}

export async function getPurchaseImpact(
  id: string,
  action: PurchaseImpactAction,
  storeId: string,
  options: PurchaseImpactOptions = {},
) {
  // Antes de crear ningún cliente: un id mal formado no llega a Supabase.
  assertImpactDocumentId(id);

  const user = await createRouteSupabaseClient();

  return computePurchaseImpact(
    await loadPurchaseImpactInputs(
      { privileged: createAdminSupabaseClient, user },
      id,
      action,
      storeId,
      options,
    ),
  );
}
