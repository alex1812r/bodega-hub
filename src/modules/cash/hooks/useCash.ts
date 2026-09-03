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
export function useCashMovements(sessionId?: string) {
  return useQuery({
    enabled: Boolean(sessionId),
    queryKey: cashKeys.movements(sessionId ?? ""),
    queryFn: () =>
      apiFetch<{
        accountVes: number;
        items: CashMovement[];
        theoretical: { ref: number; ves: number };
      }>("/api/cash/movements", { query: { sessionId } }),
  });
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
