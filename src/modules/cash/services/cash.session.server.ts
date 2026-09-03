import { ApiError } from "@/lib/api/apiError";
import { getSupabaseErrorMessage, throwIfSupabaseError } from "@/lib/supabase/errors";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";

import type { CashMovement, CashSession } from "../types";
import { computeCashSessionTotals } from "../utils/cashSessionTotals";
import type { CloseCashSessionInput, OpenCashSessionInput } from "./cash.session.mock-server";

function mapSession(row: Record<string, unknown>): CashSession {
  const register = row.cash_registers as Record<string, unknown> | undefined;
  return {
    absorbedBySessionId: (row.absorbed_by_session_id as string | null | undefined) ?? null,
    closedAt: row.closed_at as string | null,
    closedReason: (row.closed_reason as CashSession["closedReason"]) ?? null,
    closingRef: Number(row.closing_ref ?? 0),
    closingVes: Number(row.closing_ves ?? 0),
    id: row.id as string,
    openedAt: row.opened_at as string,
    openingRef: Number(row.opening_ref ?? 0),
    openingVes: Number(row.opening_ves ?? 0),
    register: {
      createdAt: "",
      id: (register?.id ?? row.register_id) as string,
      isActive: Boolean(register?.is_active ?? true),
      name: (register?.name ?? "Caja") as string,
      storeId: (register?.store_id ?? row.store_id) as string,
      updatedAt: "",
    },
    registerId: row.register_id as string,
    status: row.status as "open" | "closed",
    theoreticalClosingRef: Number(row.theoretical_closing_ref ?? 0),
    theoreticalClosingVes: Number(row.theoretical_closing_ves ?? 0),
    vaultTransferredAt: (row.vault_transferred_at as string | null | undefined) ?? null,
  };
}

function mapMovement(row: Record<string, unknown>): CashMovement {
  return { amountRef: Number(row.amount_ref), amountVes: Number(row.amount_ves), createdAt: row.created_at as string, id: row.id as string, notes: row.notes as string | null, paymentId: row.payment_id as string | null, sessionId: row.session_id as string, type: row.type as CashMovement["type"] };
}

function rpcError(error: unknown) {
  if (!error) return;
  const message = getSupabaseErrorMessage(error);
  throw new ApiError(400, "BAD_REQUEST", message);
}

export async function getCurrentCashSession(userId: string, storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase.from("cash_sessions").select("*, cash_registers(*)").eq("store_id", storeId).eq("status", "open").eq("opened_by", userId).maybeSingle();
  throwIfSupabaseError(error);
  if (!data) {
    return null;
  }
  const session = mapSession(data as Record<string, unknown>);
  // El POS necesita el efectivo vivo de la gaveta para no ofrecer un vuelto en
  // efectivo que la caja no tiene (docs/cobro-pos-billetes.md §5).
  const movements = await supabase
    .from("cash_movements")
    .select("amount_ref, amount_ves, session_id, type")
    .eq("store_id", storeId)
    .eq("session_id", session.id);
  throwIfSupabaseError(movements.error);
  const rows = (movements.data ?? []).map((row) => {
    const record = row as Record<string, unknown>;
    return {
      amountRef: Number(record.amount_ref),
      amountVes: Number(record.amount_ves),
      createdAt: "",
      id: "",
      sessionId: session.id,
      type: record.type as CashMovement["type"],
    } satisfies CashMovement;
  });

  return { ...session, liveTotals: computeCashSessionTotals(rows, session) };
}

export async function openCashSession(input: OpenCashSessionInput, _userId: string, _storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase.rpc("open_cash_session", { p_opening_ref: input.openingRef ?? 0, p_opening_ves: input.openingVes ?? 0, p_register_id: input.registerId });
  rpcError(error);
  if (!data) throw new ApiError(500, "INTERNAL_ERROR", "No se pudo abrir la caja.");
  return mapSession(data as Record<string, unknown>);
}

export async function closeCashSession(input: CloseCashSessionInput, _userId: string, _storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase.rpc("close_cash_session", { p_closing_ref: input.closingRef, p_closing_ves: input.closingVes, p_session_id: input.sessionId });
  rpcError(error);
  if (!data) throw new ApiError(500, "INTERNAL_ERROR", "No se pudo cerrar la caja.");
  return mapSession(data as Record<string, unknown>);
}

export async function listCashMovements(sessionId: string, storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase.from("cash_movements").select("*").eq("session_id", sessionId).eq("store_id", storeId).order("created_at", { ascending: false });
  throwIfSupabaseError(error);
  const items = (data ?? []).map((row) => mapMovement(row as Record<string, unknown>));
  const session = await supabase.from("cash_sessions").select("*").eq("id", sessionId).eq("store_id", storeId).maybeSingle();
  throwIfSupabaseError(session.error);
  if (!session.data) throw new ApiError(404, "NOT_FOUND", "Sesión de caja no encontrada.");
  const base = mapSession(session.data as Record<string, unknown>);
  const totals = computeCashSessionTotals(items, base);
  return {
    accountVes: totals.accountVes,
    items,
    theoretical: { ref: totals.cashRef, ves: totals.cashVes },
  };
}

export async function listOpenCashSessions(storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase.from("cash_sessions").select("*, cash_registers(*)").eq("store_id", storeId).eq("status", "open");
  throwIfSupabaseError(error);
  const sessions = (data ?? []).map((row) => mapSession(row as Record<string, unknown>));
  if (sessions.length === 0) {
    return sessions;
  }
  const movements = await supabase
    .from("cash_movements")
    .select("amount_ref, amount_ves, session_id, type")
    .eq("store_id", storeId)
    .in("session_id", sessions.map((session) => session.id));
  throwIfSupabaseError(movements.error);
  const bySession = new Map<string, CashMovement[]>();
  for (const row of movements.data ?? []) {
    const record = row as Record<string, unknown>;
    const sessionId = record.session_id as string;
    const list = bySession.get(sessionId) ?? [];
    list.push({
      amountRef: Number(record.amount_ref),
      amountVes: Number(record.amount_ves),
      createdAt: "",
      id: "",
      sessionId,
      type: record.type as CashMovement["type"],
    });
    bySession.set(sessionId, list);
  }
  return sessions.map((session) => ({
    ...session,
    liveTotals: computeCashSessionTotals(bySession.get(session.id) ?? [], session),
  }));
}

/** Turnos de una caja, del mas reciente al mas antiguo, con saldos vivos si sigue abierto. */
export async function listRegisterSessions(registerId: string, storeId: string, limit = 20) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("cash_sessions")
    .select("*, cash_registers(*)")
    .eq("store_id", storeId)
    .eq("register_id", registerId)
    .order("opened_at", { ascending: false })
    .limit(limit);
  throwIfSupabaseError(error);
  const sessions = (data ?? []).map((row) => mapSession(row as Record<string, unknown>));
  const openSession = sessions.find((session) => session.status === "open");
  if (!openSession) {
    return sessions;
  }
  const movements = await supabase
    .from("cash_movements")
    .select("amount_ref, amount_ves, type")
    .eq("store_id", storeId)
    .eq("session_id", openSession.id);
  throwIfSupabaseError(movements.error);
  const totals = computeCashSessionTotals(
    (movements.data ?? []).map((row) => {
      const record = row as Record<string, unknown>;
      return {
        amountRef: Number(record.amount_ref),
        amountVes: Number(record.amount_ves),
        type: record.type as CashMovement["type"],
      };
    }),
    openSession,
  );
  return sessions.map((session) =>
    session.id === openSession.id ? { ...session, liveTotals: totals } : session,
  );
}

/**
 * Cierres con efectivo que aun no llega al baul, incluidos los absorbidos por una apertura
 * posterior (que `transfer_cash_closures_to_vault` rechaza). Para la vista del admin;
 * `listPendingClosures` sigue devolviendo solo los transferibles.
 */
export async function listUntransferredClosures(storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("cash_sessions")
    .select("*, cash_registers(*)")
    .eq("store_id", storeId)
    .eq("status", "closed")
    .is("vault_transferred_at", null)
    .order("closed_at", { ascending: false });
  throwIfSupabaseError(error);
  return (data ?? [])
    .map((row) => mapSession(row as Record<string, unknown>))
    .filter((session) => (session.closingRef ?? 0) > 0 || (session.closingVes ?? 0) > 0);
}

/**
 * Cierres que el baul puede recibir. Desde `20260904b-cash-lifecycle.sql` la
 * apertura ya no absorbe cierres y `transfer_cash_closures_to_vault` acepta los
 * absorbidos historicos, asi que ya no se filtran: es la unica via para que ese
 * efectivo varado llegue al baul sin SQL manual.
 */
export async function listPendingClosures(storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("cash_sessions")
    .select("*, cash_registers(*)")
    .eq("store_id", storeId)
    .eq("status", "closed")
    .is("vault_transferred_at", null)
    .order("closed_at", { ascending: false });
  throwIfSupabaseError(error);
  return (data ?? [])
    .map((row) => mapSession(row as Record<string, unknown>))
    .filter((session) => (session.closingRef ?? 0) > 0 || (session.closingVes ?? 0) > 0);
}

export async function getLastUntransferredClosure(registerId: string, storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("cash_sessions")
    .select("*, cash_registers(*)")
    .eq("store_id", storeId)
    .eq("register_id", registerId)
    .eq("status", "closed")
    .is("vault_transferred_at", null)
    .order("closed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  throwIfSupabaseError(error);
  if (!data) {
    return null;
  }
  return mapSession(data as Record<string, unknown>);
}

export async function autoCloseStaleCashSessions() {
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase.rpc("auto_close_stale_cash_sessions");
  throwIfSupabaseError(error);
  const payload = (data ?? {}) as { closedCount?: number; sessionIds?: string[] };
  return {
    closedCount: Number(payload.closedCount ?? 0),
    sessionIds: payload.sessionIds ?? [],
  };
}
