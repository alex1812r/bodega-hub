import { ApiError } from "@/lib/api/apiError";

import { getCashRegister } from "./cash.registers.mock-server";
import type { CashMovement, CashSession } from "../types";

const sessions: CashSession[] = [];
const movements: CashMovement[] = [];

export type OpenCashSessionInput = { openingRef?: number; openingVes?: number; registerId: string };
export type CloseCashSessionInput = { closingRef: number; closingVes: number; sessionId: string };

function theoretical(session: CashSession) {
  return movements
    .filter((movement) => movement.sessionId === session.id)
    .reduce(
      (total, movement) => {
        const sign = ["transfer_out", "refund_out"].includes(movement.type) ? -1 : 1;
        total.ref += sign * movement.amountRef;
        total.ves += sign * movement.amountVes;
        return total;
      },
      { ref: session.openingRef, ves: session.openingVes },
    );
}

export function getCurrentCashSession(userId: string, storeId: string) {
  return sessions.find(
    (session) =>
      session.status === "open" &&
      session.register.storeId === storeId &&
      session.register.assignedUserId === userId,
  ) ?? null;
}

export function openCashSession(input: OpenCashSessionInput, userId: string, storeId: string) {
  const register = getCashRegister(input.registerId, storeId);
  if (!register.isActive || register.assignedUserId !== userId) {
    throw new ApiError(403, "FORBIDDEN", "La caja no está asignada al usuario actual.");
  }
  if (getCurrentCashSession(userId, storeId) || sessions.some((item) => item.registerId === register.id && item.status === "open")) {
    throw new ApiError(400, "BAD_REQUEST", "La caja ya tiene una sesión de caja abierta.");
  }
  const openedAt = new Date().toISOString();
  const session: CashSession = {
    id: `cash-session-${Date.now()}`,
    openedAt,
    openingRef: input.openingRef ?? 0,
    openingVes: input.openingVes ?? 0,
    register,
    registerId: register.id,
    status: "open",
  };
  sessions.push(session);
  if (session.openingRef || session.openingVes) {
    movements.push({ amountRef: session.openingRef, amountVes: session.openingVes, createdAt: openedAt, id: `cash-movement-${Date.now()}`, notes: "Monto de apertura de caja", sessionId: session.id, type: "opening" });
  }
  return session;
}

export function closeCashSession(input: CloseCashSessionInput, userId: string, storeId: string) {
  const session = sessions.find((item) => item.id === input.sessionId && item.register.storeId === storeId);
  if (!session) throw new ApiError(404, "NOT_FOUND", "Sesión de caja no encontrada.");
  if (session.register.assignedUserId !== userId) throw new ApiError(403, "FORBIDDEN", "No puedes cerrar esta sesión.");
  if (session.status !== "open") throw new ApiError(400, "BAD_REQUEST", "La sesión de caja ya está cerrada.");
  const balance = theoretical(session);
  Object.assign(session, { closedAt: new Date().toISOString(), closingRef: input.closingRef, closingVes: input.closingVes, status: "closed" as const, theoreticalClosingRef: balance.ref, theoreticalClosingVes: balance.ves });
  return session;
}

export function listCashMovements(sessionId: string, storeId: string) {
  const session = sessions.find((item) => item.id === sessionId && item.register.storeId === storeId);
  if (!session) throw new ApiError(404, "NOT_FOUND", "Sesión de caja no encontrada.");
  return { items: movements.filter((movement) => movement.sessionId === sessionId), theoretical: theoretical(session) };
}

export function addTransferOut(sessionId: string, amountVes: number, amountRef: number, notes?: string) {
  movements.push({ amountRef, amountVes, createdAt: new Date().toISOString(), id: `cash-movement-${Date.now()}`, notes, sessionId, type: "transfer_out" });
}

export function listOpenCashSessions(storeId: string) {
  return sessions.filter((session) => session.status === "open" && session.register.storeId === storeId);
}
