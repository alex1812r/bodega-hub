"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/shared/api/apiFetch";
import type { CashMovement, CashRegister, CashSession } from "../types";
export const cashKeys = {
  all: ["cash"] as const,
  registers: ["cash", "registers"] as const,
  session: ["cash", "session"] as const,
  pendingClosures: ["cash", "pending-closures"] as const,
  lastUntransferredClosure: (registerId: string) =>
    ["cash", "last-untransferred-closure", registerId] as const,
  movements: (sessionId: string) => ["cash", "movements", sessionId] as const,
  register: (registerId: string) => ["cash", "registers", registerId] as const,
  registerSessions: (registerId: string) =>
    ["cash", "register-sessions", registerId] as const,
};
export function useCashRegisters() {
  return useQuery({
    queryKey: cashKeys.registers,
    queryFn: () => apiFetch<CashRegister[]>("/api/cash/registers"),
  });
}
export function useCashRegister(id: string) {
  return useQuery({
    enabled: Boolean(id),
    queryKey: cashKeys.register(id),
    queryFn: () => apiFetch<CashRegister>(`/api/cash/registers/${id}`),
  });
}
export function useCashRegisterSessions(id: string) {
  return useQuery({
    enabled: Boolean(id),
    queryKey: cashKeys.registerSessions(id),
    queryFn: () => apiFetch<CashSession[]>(`/api/cash/registers/${id}/sessions`),
  });
}
export function useMyCashSession() {
  return useQuery({
    queryKey: cashKeys.session,
    queryFn: () => apiFetch<CashSession | null>("/api/cash/session"),
  });
}
export function useOpenCashSessions() {
  return useQuery({
    queryKey: [...cashKeys.all, "open-sessions"],
    queryFn: () => apiFetch<CashSession[]>("/api/cash/session/open"),
  });
}
export function useUntransferredCashClosures() {
  return useQuery({
    queryKey: [...cashKeys.all, "untransferred-closures"],
    queryFn: () => apiFetch<CashSession[]>("/api/cash/closures/untransferred"),
  });
}
export function usePendingCashClosures() {
  return useQuery({
    queryKey: cashKeys.pendingClosures,
    queryFn: () => apiFetch<CashSession[]>("/api/cash/closures/pending"),
  });
}
export function useLastUntransferredClosure(registerId?: string, enabled = true) {
  return useQuery({
    enabled: Boolean(registerId) && enabled,
    queryKey: cashKeys.lastUntransferredClosure(registerId ?? ""),
    queryFn: () =>
      apiFetch<CashSession | null>(
        `/api/cash/registers/${registerId}/last-untransferred-closure`,
      ),
  });
}
export type CashSessionTotals = {
  accountVes: number;
  items: CashMovement[];
  theoretical: { ref: number; ves: number };
};
/** Misma clave y misma lectura para la pantalla, el diálogo de cierre y el cierre vencido. */
export function cashMovementsQuery(sessionId: string) {
  return {
    queryKey: cashKeys.movements(sessionId),
    queryFn: () =>
      apiFetch<CashSessionTotals>("/api/cash/movements", { query: { sessionId } }),
  };
}
/**
 * `alwaysFresh`: la pantalla que enseña el dinero del turno no se fía de la caché (una
 * venta hecha hace segundos en el POS aún no estaría): relee siempre al montar.
 */
export function useCashMovements(sessionId?: string, options: { alwaysFresh?: boolean } = {}) {
  return useQuery({
    ...cashMovementsQuery(sessionId ?? ""),
    enabled: Boolean(sessionId),
    ...(options.alwaysFresh ? { staleTime: 0 } : {}),
  });
}
export type CashCloseTotals = {
  errorMessage: string | null;
  retry: () => void;
  /** `ready` solo con una lectura hecha DESPUÉS de abrir el cierre y sin otra en curso. */
  status: "error" | "loading" | "ready";
  /** Último dato conocido: puede ser de caché mientras `status` no sea `ready`. */
  totals: CashSessionTotals | null;
};
const CLOSE_TOTALS_ERROR = "No se pudieron leer los totales de la caja.";
function closeTotalsStatus(
  open: boolean,
  query: { data?: CashSessionTotals; isError: boolean; isFetching: boolean },
): CashCloseTotals["status"] {
  if (!open || query.isFetching) {
    return "loading";
  }
  if (query.isError) {
    return "error";
  }
  return query.data ? "ready" : "loading";
}
/**
 * Totales para cerrar una caja: cada apertura del cierre los vuelve a pedir al servidor.
 * Lo contado viaja tal cual al cierre, así que un teórico de caché (p. ej. anterior a la
 * última venta) acabaría asentado como faltante.
 */
export function useCashCloseTotals(sessionId: string, open: boolean): CashCloseTotals {
  const query = useQuery({
    ...cashMovementsQuery(sessionId),
    enabled: open && Boolean(sessionId),
    staleTime: 0,
  });
  const status = closeTotalsStatus(open, query);

  return {
    errorMessage:
      status === "error"
        ? query.error instanceof Error
          ? query.error.message
          : CLOSE_TOTALS_ERROR
        : null,
    retry: () => void query.refetch(),
    status,
    totals: query.data ?? null,
  };
}
function useCashMutation<T>(path: string, method = "POST") {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: object) => apiFetch<T>(path, { body, method }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: cashKeys.all }),
  });
}
export function useCreateCashRegister() {
  return useCashMutation<CashRegister>("/api/cash/registers");
}
export function useUpdateCashRegister(id: string) {
  return useCashMutation<CashRegister>(`/api/cash/registers/${id}`, "PATCH");
}
export function useOpenCashSession() {
  return useCashMutation<CashSession>("/api/cash/session/open");
}
export function useCloseCashSession() {
  return useCashMutation<CashSession>("/api/cash/session/close");
}
