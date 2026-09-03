import type { ApiDataSource } from "@/lib/api/dataSource";
import type { UserRole } from "@/shared/auth/permissions";

/** Alcance de una herramienta: tienda (admin) o plataforma (superadmin). */
export type AssistantToolScope = "platform" | "store";

/**
 * Contexto que reciben las herramientas por closure. Nunca llega del modelo:
 * `storeIds` sale de la sesion (admin) o se resuelve server-side (superadmin).
 */
export type AssistantToolContext = {
  dataSource: ApiDataSource;
  role: UserRole;
  scope: AssistantToolScope;
  storeIds: string[];
  storeName: string | null;
  /** YYYY-MM-DD en America/Caracas. */
  today: string;
  userId: string;
};

export type AssistantToolRange = {
  from: string;
  to: string;
};

export type AssistantToolOk<T> = {
  data: T;
  note?: string;
  ok: true;
  range?: AssistantToolRange;
  source: string;
};

export type AssistantToolFail = {
  error: string;
  ok: false;
  options?: string[];
};

export type AssistantToolResult<T> = AssistantToolFail | AssistantToolOk<T>;

export type AssistantUsage = {
  limit: number;
  /** ISO del proximo reinicio del contador (00:00 Caracas del dia siguiente). */
  resetsAt: string;
  used: number;
};

export type AssistantQueryLogInput = {
  durationMs: number;
  error?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  question: string;
  role: UserRole;
  storeId: string | null;
  tools: Array<{ input: unknown; name: string }>;
  userId: string;
};
