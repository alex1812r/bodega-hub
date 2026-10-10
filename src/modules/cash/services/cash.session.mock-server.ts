import { ApiError } from "@/lib/api/apiError";

import {
  cashSessionAutoCloseReason,
  isCashSessionExpired,
} from "../utils/cashSessionDeadline";
import { computeCashSessionTotals } from "../utils/cashSessionTotals";
import { getCashRegister } from "./cash.registers.mock-server";
import type { CashMovement, CashSession } from "../types";

const sessions: CashSession[] = [];
const movements: CashMovement[] = [];
/** Quién abrió cada turno (`cash_sessions.opened_by`): decide de quién es. */
const openedBy = new Map<string, string>();

export type OpenCashSessionInput = { openingRef?: number; openingVes?: number; registerId: string };
export type CloseCashSessionInput = { closingRef: number; closingVes: number; sessionId: string };
export type CashSessionOwner = { openedBy: string | null };

/**
 * Reglas de apertura que el BFF aplica a todo el que opera caja (POS-F3). Son las
 * que `open_cash_session` ya imponía al vendedor: solo su caja asignada, y como
 * cada usuario tiene una sola caja activa, un único turno abierto a la vez.
 */
export const CASH_REGISTER_NOT_ASSIGNED_MESSAGE = "La caja no está asignada al usuario actual.";
export const CASH_SESSION_ALREADY_OPEN_MESSAGE =
  "Ya tienes una caja abierta. Ciérrala antes de abrir otra.";
export const CASH_SESSION_NOT_FOUND_MESSAGE = "Sesión de caja no encontrada.";

function sessionTotals(session: CashSession) {
  return computeCashSessionTotals(
    movements.filter((movement) => movement.sessionId === session.id),
    session,
  );
}

function theoretical(session: CashSession) {
  const totals = sessionTotals(session);
  return { ref: totals.cashRef, ves: totals.cashVes };
}

/** Turno abierto por el usuario; si hubiera más de uno, el más reciente. */
export function getCurrentCashSession(userId: string, storeId: string) {
  const session = sessions
    .filter(
      (candidate) =>
        candidate.status === "open" &&
        candidate.register.storeId === storeId &&
        openedBy.get(candidate.id) === userId,
    )
    .reduce<CashSession | undefined>(
      (latest, candidate) =>
        latest && Date.parse(latest.openedAt) > Date.parse(candidate.openedAt) ? latest : candidate,
      undefined,
    );

  // El POS usa `liveTotals` para limitar el vuelto en efectivo al contenido real
  // de la gaveta (docs/cobro-pos-billetes.md §5).
  return session ? { ...session, liveTotals: sessionTotals(session) } : null;
}

export function openCashSession(input: OpenCashSessionInput, userId: string, storeId: string) {
  const register = getCashRegister(input.registerId, storeId);
  if (!register.isActive || register.assignedUserId !== userId) {
    throw new ApiError(403, "FORBIDDEN", CASH_REGISTER_NOT_ASSIGNED_MESSAGE);
  }
  const current = getCurrentCashSession(userId, storeId);
  if (current && current.registerId !== register.id) {
    throw new ApiError(409, "CONFLICT", CASH_SESSION_ALREADY_OPEN_MESSAGE);
  }
  if (sessions.some((item) => item.registerId === register.id && item.status === "open")) {
    throw new ApiError(400, "BAD_REQUEST", "La caja ya tiene una sesión de caja abierta.");
  }
  const openedAt = new Date().toISOString();
  const session: CashSession = {
    id: `cash-session-${Date.now()}-${sessions.length}`,
    openedAt,
    openingRef: input.openingRef ?? 0,
    openingVes: input.openingVes ?? 0,
    register,
    registerId: register.id,
    status: "open",
  };
  sessions.push(session);
  openedBy.set(session.id, userId);
  // Desde `20260904b-cash-lifecycle.sql` la apertura ya no absorbe los cierres
  // previos: el efectivo del turno anterior sigue siendo transferible al baul.
  if (session.openingRef || session.openingVes) {
    movements.push({ amountRef: session.openingRef, amountVes: session.openingVes, createdAt: openedAt, id: `cash-movement-${Date.now()}`, notes: "Monto de apertura de caja", sessionId: session.id, type: "opening" });
  }
  return session;
}

/** Quién abrió el turno, o `null` si no existe en la tienda. */
export function getCashSessionOwner(sessionId: string, storeId: string): CashSessionOwner | null {
  const session = sessions.find((item) => item.id === sessionId && item.register.storeId === storeId);

  return session ? { openedBy: openedBy.get(session.id) ?? null } : null;
}

export function closeCashSession(input: CloseCashSessionInput, userId: string, storeId: string) {
  const session = sessions.find((item) => item.id === input.sessionId && item.register.storeId === storeId);
  if (!session) throw new ApiError(404, "NOT_FOUND", CASH_SESSION_NOT_FOUND_MESSAGE);
  if (openedBy.get(session.id) !== userId) throw new ApiError(403, "FORBIDDEN", "No puedes cerrar esta sesión.");
  if (session.status !== "open") throw new ApiError(400, "BAD_REQUEST", "La sesión de caja ya está cerrada.");
  const balance = theoretical(session);
  Object.assign(session, {
    closedAt: new Date().toISOString(),
    closedReason: "manual" as const,
    closingRef: input.closingRef,
    closingVes: input.closingVes,
    status: "closed" as const,
    theoreticalClosingRef: balance.ref,
    theoreticalClosingVes: balance.ves,
    vaultTransferredAt: null,
  });
  return session;
}

export function autoCloseStaleCashSessions(now = new Date()) {
  const closedIds: string[] = [];

  for (const session of sessions) {
    if (session.status !== "open" || !isCashSessionExpired(session.openedAt, now)) {
      continue;
    }

    const balance = theoretical(session);
    Object.assign(session, {
      closedAt: now.toISOString(),
      closedReason: cashSessionAutoCloseReason(session.openedAt),
      closingRef: balance.ref,
      closingVes: balance.ves,
      status: "closed" as const,
      theoreticalClosingRef: balance.ref,
      theoreticalClosingVes: balance.ves,
    });
    closedIds.push(session.id);
  }

  return { closedCount: closedIds.length, sessionIds: closedIds };
}

export function listCashMovements(sessionId: string, storeId: string) {
  const session = sessions.find((item) => item.id === sessionId && item.register.storeId === storeId);
  if (!session) throw new ApiError(404, "NOT_FOUND", "Sesión de caja no encontrada.");
  const totals = sessionTotals(session);
  return {
    accountVes: totals.accountVes,
    items: movements.filter((movement) => movement.sessionId === sessionId),
    theoretical: { ref: totals.cashRef, ves: totals.cashVes },
  };
}

export function addTransferOut(sessionId: string, amountVes: number, amountRef: number, notes?: string) {
  movements.push({ amountRef, amountVes, createdAt: new Date().toISOString(), id: `cash-movement-${Date.now()}`, notes, sessionId, type: "transfer_out" });
}

export function markSessionsTransferredToVault(sessionIds: string[], storeId: string) {
  const selected = sessions.filter(
    (session) =>
      sessionIds.includes(session.id) &&
      session.register.storeId === storeId &&
      session.status === "closed" &&
      !session.vaultTransferredAt,
  );
  if (selected.length !== sessionIds.length) {
    throw new ApiError(400, "BAD_REQUEST", "Solo se pueden transferir cierres pendientes al baúl.");
  }
  const transferredAt = new Date().toISOString();
  for (const session of selected) {
    if ((session.closingRef ?? 0) <= 0 && (session.closingVes ?? 0) <= 0) {
      throw new ApiError(400, "BAD_REQUEST", "El cierre no tiene monto para transferir.");
    }
    session.vaultTransferredAt = transferredAt;
  }
  return selected;
}

export function listOpenCashSessions(storeId: string) {
  return sessions
    .filter((session) => session.status === "open" && session.register.storeId === storeId)
    .map((session) => ({
      ...session,
      liveTotals: sessionTotals(session),
      openedBy: openedBy.get(session.id) ?? null,
    }));
}

export function listRegisterSessions(registerId: string, storeId: string, limit = 20) {
  return sessions
    .filter(
      (session) => session.registerId === registerId && session.register.storeId === storeId,
    )
    .sort((left, right) => Date.parse(right.openedAt) - Date.parse(left.openedAt))
    .slice(0, limit)
    .map((session) =>
      session.status === "open" ? { ...session, liveTotals: sessionTotals(session) } : session,
    );
}

export function listUntransferredClosures(storeId: string) {
  return sessions.filter(
    (session) =>
      session.status === "closed" &&
      session.register.storeId === storeId &&
      !session.vaultTransferredAt &&
      ((session.closingRef ?? 0) > 0 || (session.closingVes ?? 0) > 0),
  );
}

export function listPendingClosures(storeId: string) {
  return sessions.filter(
    (session) =>
      session.status === "closed" &&
      session.register.storeId === storeId &&
      !session.vaultTransferredAt &&
      ((session.closingRef ?? 0) > 0 || (session.closingVes ?? 0) > 0),
  );
}

export function getLastUntransferredClosure(registerId: string, storeId: string) {
  const lastClosed = sessions
    .filter(
      (session) =>
        session.registerId === registerId &&
        session.register.storeId === storeId &&
        session.status === "closed" &&
        !session.vaultTransferredAt,
    )
    .sort((left, right) => {
      const leftTime = left.closedAt ? Date.parse(left.closedAt) : 0;
      const rightTime = right.closedAt ? Date.parse(right.closedAt) : 0;
      return rightTime - leftTime;
    })[0];

  return lastClosed ?? null;
}
