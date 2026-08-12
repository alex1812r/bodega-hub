"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/shared/api/apiFetch";
import type { CashMovement, CashRegister, CashSession } from "../types";
export const cashKeys = { all: ["cash"] as const, registers: ["cash", "registers"] as const, session: ["cash", "session"] as const, movements: (sessionId: string) => ["cash", "movements", sessionId] as const };
export function useCashRegisters() { return useQuery({ queryKey: cashKeys.registers, queryFn: () => apiFetch<CashRegister[]>("/api/cash/registers") }); }
export function useMyCashSession() { return useQuery({ queryKey: cashKeys.session, queryFn: () => apiFetch<CashSession | null>("/api/cash/session") }); }
export function useOpenCashSessions() { return useQuery({ queryKey: [...cashKeys.all, "open-sessions"], queryFn: () => apiFetch<CashSession[]>("/api/cash/session/open") }); }
export function useCashMovements(sessionId?: string) { return useQuery({ enabled: Boolean(sessionId), queryKey: cashKeys.movements(sessionId ?? ""), queryFn: () => apiFetch<{ items: CashMovement[]; theoretical: { ref: number; ves: number } }>("/api/cash/movements", { query: { sessionId } }) }); }
function useCashMutation<T>(path: string, method = "POST") { const queryClient = useQueryClient(); return useMutation({ mutationFn: (body: object) => apiFetch<T>(path, { body, method }), onSuccess: () => void queryClient.invalidateQueries({ queryKey: cashKeys.all }) }); }
export function useCreateCashRegister() { return useCashMutation<CashRegister>("/api/cash/registers"); }
export function useUpdateCashRegister(id: string) { return useCashMutation<CashRegister>(`/api/cash/registers/${id}`, "PATCH"); }
export function useOpenCashSession() { return useCashMutation<CashSession>("/api/cash/session/open"); }
export function useCloseCashSession() { return useCashMutation<CashSession>("/api/cash/session/close"); }
