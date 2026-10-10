import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api/apiError";
import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { assertCanAccessPayment } from "@/shared/auth/paymentAccess";
import type { UserRole } from "@/shared/auth/permissions";
import type { ImpactLedgerAccess } from "@/shared/impact/impactAccess";
import { assertImpactDocumentId } from "@/shared/impact/impactServer";
import type {
  PaymentMethod,
  PaymentStatus,
  PurchaseStatus,
  SaleStatus,
} from "@/shared/mocks/erp-data";

import {
  computePaymentImpact,
  type PaymentImpactAction,
  type PaymentImpactInputs,
  type PaymentImpactLedger,
} from "./paymentImpact";

type ReadClient = Pick<SupabaseClient, "from">;

/**
 * Clientes de LECTURA del impact.
 *
 * - `user`: JWT de quien pide el impact. Con él se lee el pago, su documento,
 *   los asientos de baúl y el baúl; es quien decide el 404 de un pago ajeno.
 *   La RLS de `store_vaults` solo filtra por tienda: los saldos del baúl los
 *   protege el BFF, que no los lee sin `vault.view` (`ImpactLedgerAccess`, AUD-01).
 * - `privileged`: service role, SOLO para `cash_movements` con su sesión y su
 *   caja. La RLS de esas tablas no deja ver los asientos de la caja de otro
 *   usuario y `cancel_payment_apply` (security definer) borra los de cualquier
 *   caja. Va filtrada por `store_id` y por un pago ya validado.
 */
export type PaymentImpactClients = {
  privileged: () => ReadClient;
  user: ReadClient;
};

type PaymentRow = {
  amount: number;
  amount_ref: number;
  amount_ves: number;
  change_method: PaymentMethod | null;
  change_ref: number | null;
  change_ves: number | null;
  contact: { name: string } | null;
  currency: string;
  id: string;
  method: PaymentMethod;
  purchase: {
    id: string;
    paid_ref: number | null;
    paid_ves: number;
    purchase_number: string;
    status: PurchaseStatus;
    total_ref: number;
    total_ves: number;
  } | null;
  purchase_id: string | null;
  sale: {
    id: string;
    invoice_number: string;
    paid_ves: number;
    status: SaleStatus;
    total_ves: number;
  } | null;
  sale_id: string | null;
  status: PaymentStatus | null;
};

type CashMovementRow = {
  amount_ref: number;
  amount_ves: number;
  session: {
    register: { name: string } | null;
    status: "closed" | "open";
    vault_transferred_at: string | null;
  } | null;
  type: string;
};

type VaultMovementRow = {
  amount_ref: number | null;
  amount_ves: number;
  id: string;
  type: string;
  vault_id: string;
};

type VaultRow = {
  balance_efectivo_ves: number;
  balance_ref: number;
  balance_ves: number;
  id: string;
};

const PAYMENT_NOT_FOUND = "Pago no encontrado.";
/** Roles a los que `cancel_payment` deja anular (20261006b). */
const CANCEL_ROLES: readonly UserRole[] = ["admin", "contador"];

/** Asientos de caja y baúl del pago: lo que `cancel_payment_apply` va a revertir. */
async function loadLedger(
  clients: PaymentImpactClients,
  storeId: string,
  paymentId: string,
  access: ImpactLedgerAccess,
): Promise<PaymentImpactLedger> {
  const [cash, vaultMovements, vault] = await Promise.all([
    clients
      .privileged()
      .from("cash_movements")
      .select(
        "type, amount_ves, amount_ref, session:cash_sessions(status, vault_transferred_at, register:cash_registers(name))",
      )
      .eq("store_id", storeId)
      .eq("payment_id", paymentId)
      .returns<CashMovementRow[]>(),
    clients.user
      .from("vault_movements")
      .select("id, type, vault_id, amount_ves, amount_ref")
      .eq("store_id", storeId)
      .eq("payment_id", paymentId)
      .in("type", ["sale_in", "withdrawal", "purchase_out"])
      .returns<VaultMovementRow[]>(),
    // Sin `vault.view` los saldos del baúl no se consultan (ni se devuelven).
    access.canViewVault
      ? clients.user
          .from("store_vaults")
          .select("id, balance_ves, balance_efectivo_ves, balance_ref")
          .eq("store_id", storeId)
          .maybeSingle<VaultRow>()
      : { data: null, error: null },
  ]);

  throwIfSupabaseError(cash.error);
  throwIfSupabaseError(vaultMovements.error);
  throwIfSupabaseError(vault.error);

  return {
    cashMovements: (cash.data ?? []).map((row) => ({
      amountRef: Number(row.amount_ref),
      amountVes: Number(row.amount_ves),
      registerName: row.session?.register?.name ?? null,
      sessionStatus: row.session?.status ?? "open",
      type: row.type,
      vaultTransferredAt: row.session?.vault_transferred_at ?? null,
    })),
    hidden:
      access.canViewCash && access.canViewVault
        ? undefined
        : { cash: !access.canViewCash, vault: !access.canViewVault },
    kind: "full",
    vault: vault.data
      ? {
          balanceEfectivoVes: Number(vault.data.balance_efectivo_ves),
          balanceRef: Number(vault.data.balance_ref),
          balanceVes: Number(vault.data.balance_ves),
          id: vault.data.id,
        }
      : null,
    vaultMovements: (vaultMovements.data ?? []).map((row) => ({
      amountRef: Number(row.amount_ref ?? 0),
      amountVes: Number(row.amount_ves),
      id: row.id,
      type: row.type,
      vaultId: row.vault_id,
    })),
  };
}

function documentOf(payment: PaymentRow): PaymentImpactInputs["document"] {
  const contactName = payment.contact?.name ?? null;

  if (payment.sale_id) {
    if (!payment.sale) {
      throw new ApiError(404, "NOT_FOUND", "Venta no encontrada.");
    }

    return {
      contactName,
      id: payment.sale.id,
      kind: "sale",
      number: payment.sale.invoice_number,
      paidVes: Number(payment.sale.paid_ves),
      status: payment.sale.status,
      totalVes: Number(payment.sale.total_ves),
    };
  }

  // Sin venta, `cancel_payment_apply` busca la compra y falla si no está.
  if (!payment.purchase) {
    throw new ApiError(404, "NOT_FOUND", "Compra no encontrada.");
  }

  return {
    contactName,
    id: payment.purchase.id,
    kind: "purchase",
    number: payment.purchase.purchase_number,
    paidRef: Number(payment.purchase.paid_ref ?? 0),
    paidVes: Number(payment.purchase.paid_ves),
    status: payment.purchase.status,
    totalRef: Number(payment.purchase.total_ref),
    totalVes: Number(payment.purchase.total_ves),
  };
}

/**
 * Lee (solo `select`) lo que `cancel_payment` va a mirar. El pago de otra
 * tienda o inexistente responde 404; el de compra para un rol que no opera
 * pagos de compras, 403 (misma regla que `PATCH /api/payments/[id]/cancel`).
 */
export async function loadPaymentImpactInputs(
  clients: PaymentImpactClients,
  paymentId: string,
  action: PaymentImpactAction,
  storeId: string,
  role: UserRole,
  access: ImpactLedgerAccess,
): Promise<PaymentImpactInputs> {
  assertImpactDocumentId(paymentId);

  const { data: payment, error } = await clients.user
    .from("payments")
    .select(
      "id, method, currency, amount, amount_ves, amount_ref, change_method, change_ves, change_ref, status, sale_id, purchase_id, contact:contacts(name), sale:sales(id, invoice_number, status, paid_ves, total_ves), purchase:purchases(id, purchase_number, status, paid_ves, paid_ref, total_ves, total_ref)",
    )
    .eq("id", paymentId)
    .eq("store_id", storeId)
    .maybeSingle<PaymentRow>();

  throwIfSupabaseError(error);

  if (!payment) {
    throw new ApiError(404, "NOT_FOUND", PAYMENT_NOT_FOUND);
  }

  assertCanAccessPayment(role, payment);

  const status = payment.status ?? "activo";

  return {
    action,
    canCancelPayments: CANCEL_ROLES.includes(role),
    document: documentOf(payment),
    // Un pago ya anulado no tiene nada que revertir: no hace falta leer sus asientos.
    ledger:
      status === "anulado"
        ? { cashMovements: [], kind: "full", vault: null, vaultMovements: [] }
        : await loadLedger(clients, storeId, payment.id, access),
    payment: {
      amount: Number(payment.amount),
      amountRef: Number(payment.amount_ref),
      amountVes: Number(payment.amount_ves),
      changeMethod: payment.change_method,
      changeRef: Number(payment.change_ref ?? 0),
      changeVes: Number(payment.change_ves ?? 0),
      currency: payment.currency === "USD" ? "USD" : "VES",
      id: payment.id,
      method: payment.method,
      status,
    },
  };
}

export async function getPaymentImpact(
  id: string,
  action: PaymentImpactAction,
  storeId: string,
  role: UserRole,
  access: ImpactLedgerAccess,
) {
  // Antes de crear ningún cliente: un id mal formado no llega a Supabase.
  assertImpactDocumentId(id);

  const user = await createRouteSupabaseClient();

  return computePaymentImpact(
    await loadPaymentImpactInputs(
      { privileged: createAdminSupabaseClient, user },
      id,
      action,
      storeId,
      role,
      access,
    ),
  );
}
