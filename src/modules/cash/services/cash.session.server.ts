import { ApiError } from "@/lib/api/apiError";
import { getSupabaseErrorMessage, throwIfSupabaseError } from "@/lib/supabase/errors";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import type { CashMovement, CashSession } from "../types";
import type { CloseCashSessionInput, OpenCashSessionInput } from "./cash.session.mock-server";

function mapSession(row: Record<string, unknown>): CashSession {
  const register = row.cash_registers as Record<string, unknown> | undefined;
  return {
    closedAt: row.closed_at as string | null,
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
  return data ? mapSession(data as Record<string, unknown>) : null;
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
  const theoretical = items.reduce((total, movement) => {
    const sign = ["transfer_out", "refund_out"].includes(movement.type) ? -1 : 1;
    total.ref += sign * movement.amountRef; total.ves += sign * movement.amountVes; return total;
  }, { ref: base.openingRef, ves: base.openingVes });
  return { items, theoretical };
}

export async function listOpenCashSessions(storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase.from("cash_sessions").select("*, cash_registers(*)").eq("store_id", storeId).eq("status", "open");
  throwIfSupabaseError(error);
  return (data ?? []).map((row) => mapSession(row as Record<string, unknown>));
}
