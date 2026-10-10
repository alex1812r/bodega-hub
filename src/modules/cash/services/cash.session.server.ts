import { ApiError } from "@/lib/api/apiError";
import { getSupabaseErrorMessage, throwIfSupabaseError } from "@/lib/supabase/errors";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";

import type { CashMovement, CashSession } from "../types";
import { computeCashSessionTotals } from "../utils/cashSessionTotals";
import {
  CASH_REGISTER_NOT_ASSIGNED_MESSAGE,
  CASH_SESSION_ALREADY_OPEN_MESSAGE,
  type CashSessionOwner,
  type CloseCashSessionInput,
  type OpenCashSessionInput,
} from "./cash.session.mock-server";

/**
 * Un teórico ausente (turno abierto o cierre histórico sin teórico guardado) es
 * `null`, no 0: con 0 la pantalla mostraba todo lo contado como sobrante.
 */
function nullableAmount(value: unknown) {
  return value == null ? null : Number(value);
}

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
    theoreticalClosingRef: nullableAmount(row.theoretical_closing_ref),
    theoreticalClosingVes: nullableAmount(row.theoretical_closing_ves),
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

/**
 * Turno abierto por el usuario. Datos previos a POS-F3 pueden dejarle más de uno:
 * se devuelve el más reciente (antes `maybeSingle` fallaba con 404) y, al cerrarlo,
 * aparece el siguiente.
 */
export async function getCurrentCashSession(userId: string, storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("cash_sessions")
    .select("*, cash_registers(*)")
    .eq("store_id", storeId)
    .eq("status", "open")
    .eq("opened_by", userId)
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();
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

/** Quién abrió el turno (`cash_sessions.opened_by`), o `null` si no existe en la tienda. */
export async function getCashSessionOwner(
  sessionId: string,
  storeId: string,
): Promise<CashSessionOwner | null> {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("cash_sessions")
    .select("opened_by")
    .eq("id", sessionId)
    .eq("store_id", storeId)
    .maybeSingle();
  throwIfSupabaseError(error);

  if (!data) {
    return null;
  }

  return { openedBy: ((data as Record<string, unknown>).opened_by as string | null) ?? null };
}

/**
 * `open_cash_session` solo exige caja asignada al rol vendedor; al admin que vende
 * («El administrador puede vender») le dejaba abrir cualquier caja y varias a la
 * vez (POS-F3). Estas dos lecturas le aplican la misma regla antes del RPC, que no
 * cambia. Una caja que el usuario no puede leer (RLS: el vendedor solo ve la suya)
 * o el reintento sobre la misma caja siguen llegando al RPC, con su rechazo de siempre.
 */
async function assertCanOpenCashSession(
  supabase: Awaited<ReturnType<typeof createRouteSupabaseClient>>,
  registerId: string,
  userId: string,
  storeId: string,
) {
  const register = await supabase
    .from("cash_registers")
    .select("assigned_user_id")
    .eq("id", registerId)
    .eq("store_id", storeId)
    .maybeSingle();
  throwIfSupabaseError(register.error);

  if (register.data && (register.data as Record<string, unknown>).assigned_user_id !== userId) {
    throw new ApiError(403, "FORBIDDEN", CASH_REGISTER_NOT_ASSIGNED_MESSAGE);
  }

  const elsewhere = await supabase
    .from("cash_sessions")
    .select("id")
    .eq("store_id", storeId)
    .eq("status", "open")
    .eq("opened_by", userId)
    .neq("register_id", registerId)
    .limit(1);
  throwIfSupabaseError(elsewhere.error);

  if ((elsewhere.data ?? []).length > 0) {
    throw new ApiError(409, "CONFLICT", CASH_SESSION_ALREADY_OPEN_MESSAGE);
  }
}

export async function openCashSession(input: OpenCashSessionInput, userId: string, storeId: string) {
  const supabase = await createRouteSupabaseClient();
  await assertCanOpenCashSession(supabase, input.registerId, userId, storeId);
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
