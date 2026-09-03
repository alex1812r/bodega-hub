import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { caracasDateToUtcRange } from "@/shared/utils/caracasBusinessDay";

import type { AssistantQueryLogInput } from "../types";

/**
 * Tabla `assistant_queries`
 * (parche `supabase/patches/20260902-assistant-queries.sql`).
 * Se escribe con service role: el cliente nunca inserta.
 */
export async function countQueriesForDay(userId: string, day: string) {
  const { endUtcExclusive, startUtc } = caracasDateToUtcRange(day);
  const supabase = createAdminSupabaseClient();
  const { count, error } = await supabase
    .from("assistant_queries")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", startUtc)
    .lt("created_at", endUtcExclusive);

  throwIfSupabaseError(error);

  return count ?? 0;
}

export async function logQuery(input: AssistantQueryLogInput) {
  const supabase = createAdminSupabaseClient();
  const { error } = await supabase.from("assistant_queries").insert({
    duration_ms: input.durationMs,
    error: input.error ?? null,
    input_tokens: input.inputTokens ?? null,
    output_tokens: input.outputTokens ?? null,
    question: input.question,
    role: input.role,
    store_id: input.storeId,
    tools: input.tools,
    user_id: input.userId,
  });

  throwIfSupabaseError(error);
}
