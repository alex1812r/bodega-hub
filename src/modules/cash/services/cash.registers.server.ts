import { ApiError } from "@/lib/api/apiError";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import type { CashRegister } from "../types";
import type { CashRegisterInput, CashRegisterUpdateInput } from "./cash.registers.mock-server";

function mapRegister(row: Record<string, unknown>): CashRegister {
  return {
    assignedUserId: row.assigned_user_id as string | null,
    createdAt: row.created_at as string,
    id: row.id as string,
    isActive: row.is_active as boolean,
    name: row.name as string,
    storeId: row.store_id as string,
    updatedAt: row.updated_at as string,
  };
}

export async function listCashRegisters(storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase.from("cash_registers").select("*").eq("store_id", storeId).order("name");
  throwIfSupabaseError(error);
  return (data ?? []).map((row) => mapRegister(row as Record<string, unknown>));
}

export async function createCashRegister(input: CashRegisterInput, storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase.from("cash_registers").insert({ name: input.name.trim(), store_id: storeId }).select().single();
  throwIfSupabaseError(error);
  return mapRegister(data as Record<string, unknown>);
}

export async function updateCashRegister(id: string, input: CashRegisterUpdateInput, storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase.from("cash_registers").update({
    ...(input.assignedUserId !== undefined ? { assigned_user_id: input.assignedUserId } : {}),
    ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
  }).eq("id", id).eq("store_id", storeId).select().maybeSingle();
  throwIfSupabaseError(error);
  if (!data) throw new ApiError(404, "NOT_FOUND", "Caja registradora no encontrada.");
  return mapRegister(data as Record<string, unknown>);
}
