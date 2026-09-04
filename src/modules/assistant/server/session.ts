import { ApiError } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { resolveAuthProfile } from "@/lib/api/requirePermission";
import { hasEffectivePermission, isSuperadminRole } from "@/shared/auth/permissions";
import { getCaracasIsoDate } from "@/shared/utils/caracasBusinessDay";

import { listAssistantStores } from "./storeRefs";
import * as usageMock from "./usage.mock-server";
import * as usageServer from "./usage.server";
import { buildUsage, getAssistantDailyLimit } from "./usage";

import type { AssistantQueryLogInput, AssistantToolContext, AssistantUsage } from "../types";

/**
 * `requirePermission` bloquea al superadmin en cualquier permiso sin prefijo
 * `platform.`, pero el asistente es transversal: lo usan admin (modo tienda) y
 * superadmin (modo plataforma). Por eso resolvemos el contexto aqui en vez de
 * reutilizar ese guard.
 */
export async function resolveAssistantContext(request: Request): Promise<AssistantToolContext> {
  const profile = await resolveAuthProfile(request);

  if (!profile) {
    throw new ApiError(401, "UNAUTHORIZED", "Debes iniciar sesion para continuar.");
  }

  if (!profile.isActive || !hasEffectivePermission(profile, "assistant.use")) {
    throw new ApiError(403, "FORBIDDEN", "No tienes permiso para usar el asistente.");
  }

  const dataSource = resolveDataSource();
  const today = getCaracasIsoDate();
  const userId = profile.userId ?? `user-${profile.role}`;

  if (isSuperadminRole(profile.role)) {
    const stores = await listAssistantStores();

    return {
      dataSource,
      role: profile.role,
      scope: "platform",
      storeIds: stores.filter((store) => store.isActive).map((store) => store.id),
      storeName: null,
      today,
      userId,
    };
  }

  if (!profile.storeId) {
    throw new ApiError(403, "FORBIDDEN", "Tu usuario no tiene una tienda asignada.");
  }

  return {
    dataSource,
    role: profile.role,
    scope: "store",
    storeIds: [profile.storeId],
    storeName: null,
    today,
    userId,
  };
}

export async function getAssistantUsage(ctx: AssistantToolContext): Promise<AssistantUsage> {
  const used =
    ctx.dataSource === "mock"
      ? usageMock.countQueriesForDay(ctx.userId, ctx.today)
      : await usageServer.countQueriesForDay(ctx.userId, ctx.today);

  return buildUsage(used, ctx.today);
}

export function assertUnderDailyLimit(usage: AssistantUsage) {
  if (usage.used >= usage.limit) {
    throw new ApiError(
      429,
      "ASSISTANT_LIMIT_REACHED",
      `Alcanzaste el limite de ${usage.limit} consultas por dia. Vuelve a intentarlo manana.`,
      { limit: usage.limit, used: usage.used },
    );
  }
}

/** El registro nunca debe tumbar la respuesta del asistente. */
export async function logAssistantQuery(
  ctx: AssistantToolContext,
  input: AssistantQueryLogInput,
) {
  try {
    if (ctx.dataSource === "mock") {
      usageMock.logQuery(input, ctx.today);
      return;
    }

    await usageServer.logQuery(input);
  } catch (error) {
    console.error("[assistant] no se pudo registrar la consulta", error);
  }
}

export { getAssistantDailyLimit };
