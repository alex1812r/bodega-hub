import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api/apiError";
import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { assertImpactDocumentId } from "@/shared/impact/impactServer";
import type { PaymentMethod, PaymentStatus, SaleStatus } from "@/shared/mocks/erp-data";

import {
  computeSaleImpact,
  type SaleImpactAction,
  type SaleImpactInputs,
  type SaleImpactLedger,
} from "./saleImpact";

type ReadClient = Pick<SupabaseClient, "from">;

/**
 * Clientes de LECTURA del impact.
 *
 * - `user`: JWT de quien pide el impact. Con él se lee todo lo que la RLS
 *   alcanza por tienda (venta, líneas, pagos, productos, movimientos, baúl), y
 *   es quien decide el 404 de una venta ajena.
 * - `privileged`: service role, SOLO para `cash_movements` con su sesión y su
 *   caja. La RLS de esas tablas deja ver al vendedor únicamente sus propios
 *   asientos, pero `return_sale` (security definer) revierte los de cualquier
 *   caja: sin esta lectura el efecto de un cobro hecho en otra caja saldría
 *   vacío. Va filtrada por `store_id` y por los pagos de una venta ya validada.
 */
export type SaleImpactClients = {
  privileged: () => ReadClient;
  user: ReadClient;
};

type SaleRow = {
  customer: { name: string } | null;
  id: string;
  invoice_number: string;
  paid_ves: number;
  payments: Array<{
    amount: number;
    amount_ref: number;
    amount_ves: number;
    change_method: PaymentMethod | null;
    change_ref: number | null;
    change_ves: number | null;
    created_at: string;
    currency: string;
    id: string;
    method: PaymentMethod;
    status: PaymentStatus | null;
  }> | null;
  sale_items: Array<{ product_id: string; quantity: number }> | null;
  status: SaleStatus;
};

type ProductRow = {
  current_stock: number;
  id: string;
  is_active: boolean;
  name: string;
  sku: string | null;
};

type CashMovementRow = {
  amount_ref: number;
  amount_ves: number;
  payment_id: string;
  session: {
    register: { name: string } | null;
    status: "closed" | "open";
    vault_transferred_at: string | null;
  } | null;
  session_id: string;
  type: string;
};

type VaultMovementRow = {
  amount_ves: number;
  id: string;
  payment_id: string;
  type: string;
  vault_id: string;
};

const SALE_NOT_FOUND = "Venta no encontrada.";

/** Asientos de caja y baúl de los pagos activos: lo que `cancel_payment_apply` va a revertir. */
async function loadLedger(
  clients: SaleImpactClients,
  storeId: string,
  paymentIds: string[],
): Promise<SaleImpactLedger> {
  if (paymentIds.length === 0) {
    return { cashMovements: [], kind: "full", vault: null, vaultMovements: [] };
  }

  const [cash, vaultMovements, vault] = await Promise.all([
    clients
      .privileged()
      .from("cash_movements")
      .select(
        "payment_id, type, amount_ves, amount_ref, session_id, session:cash_sessions(status, vault_transferred_at, register:cash_registers(name))",
      )
      .eq("store_id", storeId)
      .in("payment_id", paymentIds)
      .returns<CashMovementRow[]>(),
    clients.user
      .from("vault_movements")
      .select("id, payment_id, type, vault_id, amount_ves")
      .eq("store_id", storeId)
      .in("payment_id", paymentIds)
      .in("type", ["sale_in", "withdrawal"])
      .returns<VaultMovementRow[]>(),
    clients.user
      .from("store_vaults")
      .select("id, balance_ves")
      .eq("store_id", storeId)
      .maybeSingle<{ balance_ves: number; id: string }>(),
  ]);

  throwIfSupabaseError(cash.error);
  throwIfSupabaseError(vaultMovements.error);
  throwIfSupabaseError(vault.error);

  return {
    cashMovements: (cash.data ?? []).map((row) => ({
      amountRef: Number(row.amount_ref),
      amountVes: Number(row.amount_ves),
      paymentId: row.payment_id,
      registerName: row.session?.register?.name ?? null,
      sessionId: row.session_id,
      sessionStatus: row.session?.status ?? "open",
      type: row.type,
      vaultTransferredAt: row.session?.vault_transferred_at ?? null,
    })),
    kind: "full",
    vault: vault.data ? { balanceVes: Number(vault.data.balance_ves), id: vault.data.id } : null,
    vaultMovements: (vaultMovements.data ?? []).map((row) => ({
      amountVes: Number(row.amount_ves),
      id: row.id,
      paymentId: row.payment_id,
      type: row.type,
      vaultId: row.vault_id,
    })),
  };
}

/**
 * Lee (solo `select`) lo que `cancel_sale` / `return_sale` van a mirar. La venta
 * de otra tienda o inexistente responde 404.
 */
export async function loadSaleImpactInputs(
  clients: SaleImpactClients,
  saleId: string,
  action: SaleImpactAction,
  storeId: string,
): Promise<SaleImpactInputs> {
  assertImpactDocumentId(saleId);

  const { data: sale, error } = await clients.user
    .from("sales")
    .select(
      "id, invoice_number, status, paid_ves, customer:contacts!sales_customer_id_fkey(name), sale_items(product_id, quantity), payments(id, method, currency, amount, amount_ves, amount_ref, change_method, change_ves, change_ref, status, created_at)",
    )
    .eq("id", saleId)
    .eq("store_id", storeId)
    .maybeSingle<SaleRow>();

  throwIfSupabaseError(error);

  if (!sale) {
    throw new ApiError(404, "NOT_FOUND", SALE_NOT_FOUND);
  }

  const items = (sale.sale_items ?? []).map((item) => ({
    productId: item.product_id,
    quantity: Number(item.quantity),
  }));
  const payments = (sale.payments ?? []).map((payment) => ({
    amount: Number(payment.amount),
    amountRef: Number(payment.amount_ref),
    amountVes: Number(payment.amount_ves),
    changeMethod: payment.change_method,
    changeRef: Number(payment.change_ref ?? 0),
    changeVes: Number(payment.change_ves ?? 0),
    createdAt: payment.created_at,
    currency: payment.currency === "USD" ? ("USD" as const) : ("VES" as const),
    id: payment.id,
    method: payment.method,
    status: payment.status ?? ("activo" as const),
  }));
  const productIds = [...new Set(items.map((item) => item.productId))];
  // `cancel_sale` no toca caja ni baúl: sus asientos solo hacen falta al devolver.
  const paymentIds =
    action === "return"
      ? payments.filter((payment) => payment.status === "activo").map((payment) => payment.id)
      : [];

  const [products, returned, ledger] = await Promise.all([
    productIds.length > 0
      ? clients.user
          .from("products")
          .select("id, name, sku, current_stock, is_active")
          .eq("store_id", storeId)
          .in("id", productIds)
          .returns<ProductRow[]>()
      : { data: [] as ProductRow[], error: null },
    clients.user
      .from("stock_movements")
      .select("product_id, quantity_delta")
      .eq("sale_id", saleId)
      .eq("type", "devolucion_cliente")
      .returns<Array<{ product_id: string; quantity_delta: number }>>(),
    loadLedger(clients, storeId, paymentIds),
  ]);

  throwIfSupabaseError(products.error);
  throwIfSupabaseError(returned.error);

  const returnedByProduct: Record<string, number> = {};
  for (const movement of returned.data ?? []) {
    returnedByProduct[movement.product_id] =
      (returnedByProduct[movement.product_id] ?? 0) + Number(movement.quantity_delta);
  }

  return {
    action,
    items,
    ledger,
    payments,
    products: (products.data ?? []).map((product) => ({
      currentStock: Number(product.current_stock),
      id: product.id,
      isActive: product.is_active,
      name: product.name,
      sku: product.sku,
    })),
    returnedByProduct,
    sale: {
      customerName: sale.customer?.name ?? null,
      id: sale.id,
      invoiceNumber: sale.invoice_number,
      paidVes: Number(sale.paid_ves),
      status: sale.status,
    },
  };
}

export async function getSaleImpact(id: string, action: SaleImpactAction, storeId: string) {
  // Antes de crear ningún cliente: un id mal formado no llega a Supabase.
  assertImpactDocumentId(id);

  const user = await createRouteSupabaseClient();

  return computeSaleImpact(
    await loadSaleImpactInputs(
      { privileged: createAdminSupabaseClient, user },
      id,
      action,
      storeId,
    ),
  );
}
