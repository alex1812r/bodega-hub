import { ApiError } from "@/lib/api/apiError";

import type { CashRegister } from "../types";

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
    id: `cash-register-${Date.now()}`,
    isActive: true,
    name: input.name.trim(),
    storeId,
    updatedAt: createdAt,
  };
  registers.push(register);
  return register;
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
