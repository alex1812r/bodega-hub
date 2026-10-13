import { ApiError } from "@/lib/api/apiError";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { mapPermissionList } from "@/lib/supabase/mappers";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { isUserRole } from "@/shared/auth/permissions";

import type { CashRegister } from "../types";
import {
  CASH_REGISTER_ASSIGNMENT_CONFLICT_MESSAGE,
  type CashRegisterInput,
  type CashRegisterUpdateInput,
} from "./cash.registers.mock-server";
import { canBeAssignedCashRegister, CASH_REGISTER_ASSIGNEE_MESSAGE } from "./cashRegisterAssignee";

const SELECT_WITH_ASSIGNEE = "*, assigned_user:profiles(full_name)";

function mapRegister(row: Record<string, unknown>): CashRegister {
  const assignedUser = row.assigned_user as { full_name?: string | null } | null | undefined;
  return {
    assignedUserId: row.assigned_user_id as string | null,
    assignedUserName: assignedUser?.full_name ?? null,
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
  const { data, error } = await supabase.from("cash_registers").select(SELECT_WITH_ASSIGNEE).eq("store_id", storeId).order("name");
  throwIfSupabaseError(error);
  return (data ?? []).map((row) => mapRegister(row as Record<string, unknown>));
}

export async function getCashRegister(id: string, storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase.from("cash_registers").select(SELECT_WITH_ASSIGNEE).eq("id", id).eq("store_id", storeId).maybeSingle();
  throwIfSupabaseError(error);
  if (!data) throw new ApiError(404, "NOT_FOUND", "Caja registradora no encontrada.");
  return mapRegister(data as Record<string, unknown>);
}

export async function createCashRegister(input: CashRegisterInput, storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase.from("cash_registers").insert({ name: input.name.trim(), store_id: storeId }).select(SELECT_WITH_ASSIGNEE).single();
  throwIfSupabaseError(error);
  return mapRegister(data as Record<string, unknown>);
}

/**
 * La caja solo se asigna a un usuario activo de la tienda con `cash.operate`
 * efectivo (vendedor, administrador con «El administrador puede vender» o permiso
 * concedido). Es una lectura previa a la actualización; desasignar no pasa por aquí.
 */
export async function assertCashRegisterAssignee(userId: string, storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("role, is_active, granted_permissions, denied_permissions")
    .eq("id", userId)
    .eq("store_id", storeId)
    .maybeSingle();
  throwIfSupabaseError(error);

  const row = data as Record<string, unknown> | null;
  const canOperate =
    row != null &&
    isUserRole(row.role) &&
    canBeAssignedCashRegister({
      deniedPermissions: mapPermissionList(row.denied_permissions),
      grantedPermissions: mapPermissionList(row.granted_permissions),
      isActive: row.is_active === true,
      role: row.role,
    });

  if (!canOperate) {
    throw new ApiError(400, "BAD_REQUEST", CASH_REGISTER_ASSIGNEE_MESSAGE);
  }
}

/**
 * `23505` del índice parcial «una caja activa por usuario y tienda». Postgres
 * nombra el índice en el mensaje; el otro único de la tabla (nombre por tienda)
 * sigue con el 409 genérico.
 */
function isActiveAssignmentConflict(error: { code?: string; message?: string } | null) {
  return (
    error?.code === "23505" &&
    (error.message ?? "").includes("cash_registers_one_active_assignment_per_store_idx")
  );
}

export async function updateCashRegister(id: string, input: CashRegisterUpdateInput, storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase.from("cash_registers").update({
    ...(input.assignedUserId !== undefined ? { assigned_user_id: input.assignedUserId } : {}),
    ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
  }).eq("id", id).eq("store_id", storeId).select(SELECT_WITH_ASSIGNEE).maybeSingle();
  if (isActiveAssignmentConflict(error)) {
    throw new ApiError(409, "CONFLICT", CASH_REGISTER_ASSIGNMENT_CONFLICT_MESSAGE);
  }
  throwIfSupabaseError(error);
  if (!data) throw new ApiError(404, "NOT_FOUND", "Caja registradora no encontrada.");
  return mapRegister(data as Record<string, unknown>);
}
