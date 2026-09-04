import type {
  AssistantToolContext,
  AssistantToolFail,
  AssistantToolOk,
  AssistantToolRange,
} from "../../types";

/** Tope duro de filas que puede devolver una herramienta al modelo. */
export const ASSISTANT_MAX_ROWS = 20;

export function ok<T>(
  source: string,
  data: T,
  extra?: { note?: string; range?: AssistantToolRange },
): AssistantToolOk<T> {
  return {
    data,
    ok: true,
    source,
    ...(extra?.note ? { note: extra.note } : {}),
    ...(extra?.range ? { range: extra.range } : {}),
  };
}

export function fail(error: string, options?: string[]): AssistantToolFail {
  return { error, ok: false, ...(options?.length ? { options } : {}) };
}

/** Convierte una excepcion en un resultado `ok:false` (el modelo nunca ve stacks). */
export function failFromError(error: unknown, fallback: string): AssistantToolFail {
  const message = error instanceof Error ? error.message : fallback;
  return fail(message || fallback);
}

export function buildParams(input: {
  extra?: Record<string, string>;
  limit?: number;
  range?: AssistantToolRange;
}) {
  const params = new URLSearchParams();

  if (input.range) {
    params.set("from", input.range.from);
    params.set("to", input.range.to);
  }

  // Pedimos de mas para poder recortar nosotros y avisar "mostrando N de M".
  params.set("limit", String(Math.min(100, Math.max(ASSISTANT_MAX_ROWS + 1, input.limit ?? 0))));

  for (const [key, value] of Object.entries(input.extra ?? {})) {
    params.set(key, value);
  }

  return params;
}

export function clampLimit(limit: number | undefined, fallback = 5) {
  if (!Number.isFinite(limit)) {
    return fallback;
  }

  return Math.min(ASSISTANT_MAX_ROWS, Math.max(1, Math.trunc(limit!)));
}

/** Recorta a `limit` filas y devuelve la nota cuando se dejo algo fuera. */
export function clampList<T>(items: T[], limit = ASSISTANT_MAX_ROWS, total = items.length) {
  const capped = Math.min(limit, ASSISTANT_MAX_ROWS);

  if (total <= capped) {
    return { items: items.slice(0, capped), note: undefined as string | undefined };
  }

  return {
    items: items.slice(0, capped),
    note: `Mostrando ${Math.min(capped, items.length)} de ${total}.`,
  };
}

/** Redondeo a centimos para no devolver ruido de coma flotante al modelo. */
export function money(value: number | null | undefined) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/**
 * Ejecuta la variante mock o supabase del servicio.
 * Las llamadas multitienda (superadmin) necesitan service role.
 */
export async function runService<T>(
  ctx: AssistantToolContext,
  implementations: {
    mock: () => T;
    server: (options: { useAdmin?: boolean }) => Promise<T>;
  },
): Promise<T> {
  if (ctx.dataSource === "mock") {
    return implementations.mock();
  }

  return implementations.server({ useAdmin: ctx.scope === "platform" });
}
