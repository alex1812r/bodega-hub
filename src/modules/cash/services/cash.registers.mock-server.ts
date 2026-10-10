import { ApiError } from "@/lib/api/apiError";
import { isStoreUserRole } from "@/shared/auth/permissions";
import { mockUserProfiles } from "@/shared/mocks/erp-data";

import type { CashRegister } from "../types";
import { canBeAssignedCashRegister, CASH_REGISTER_ASSIGNEE_MESSAGE } from "./cashRegisterAssignee";

const registers: CashRegister[] = [];

function now() {
  return new Date().toISOString();
}

export type CashRegisterInput = { name: string };
export type CashRegisterUpdateInput = {
  assignedUserId?: string | null;
  assignedUserName?: string | null;
  isActive?: boolean;
  name?: string;
};

export function listCashRegisters(storeId: string) {
  return registers.filter((register) => register.storeId === storeId);
}

export function getCashRegister(id: string, storeId: string) {
  const register = registers.find((item) => item.id === id && item.storeId === storeId);
  if (!register) throw new ApiError(404, "NOT_FOUND", "Caja registradora no encontrada.");
  return register;
}

export function createCashRegister(input: CashRegisterInput, storeId: string) {
  if (listCashRegisters(storeId).some((item) => item.name.toLowerCase() === input.name.toLowerCase())) {
    throw new ApiError(409, "CONFLICT", "Ya existe una caja con ese nombre.");
  }
  const createdAt = now();
  const register: CashRegister = {
    createdAt,
    id: `cash-register-${Date.now()}-${registers.length}`,
    isActive: true,
    name: input.name.trim(),
    storeId,
    updatedAt: createdAt,
  };
  registers.push(register);
  return register;
}

/**
 * Misma regla que el servicio real: usuario activo de la tienda con `cash.operate`.
 * Los usuarios demo por rol (`user-<rol>`, ver `getDemoUserProfile`) no siempre
 * tienen perfil mock: valen por su rol.
 */
export function assertCashRegisterAssignee(userId: string, storeId: string) {
  const demoRole = userId.startsWith("user-") ? userId.slice("user-".length) : "";
  const profile =
    mockUserProfiles.find((item) => item.id === userId && item.storeId === storeId) ??
    (isStoreUserRole(demoRole) ? { isActive: true, role: demoRole } : undefined);

  if (!profile || !canBeAssignedCashRegister(profile)) {
    throw new ApiError(400, "BAD_REQUEST", CASH_REGISTER_ASSIGNEE_MESSAGE);
  }
}

export function updateCashRegister(id: string, input: CashRegisterUpdateInput, storeId: string) {
  const register = getCashRegister(id, storeId);
  if (input.assignedUserId && input.isActive !== false) {
    const assigned = registers.find(
      (item) =>
        item.id !== id &&
        item.storeId === storeId &&
        item.isActive &&
        item.assignedUserId === input.assignedUserId,
    );
    if (assigned) throw new ApiError(409, "CONFLICT", "El usuario ya tiene una caja activa asignada.");
  }
  Object.assign(register, input, { updatedAt: now() });
  return register;
}
