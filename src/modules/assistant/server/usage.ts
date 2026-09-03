import { caracasDateToUtcRange } from "@/shared/utils/caracasBusinessDay";

import type { AssistantUsage } from "../types";

export const DEFAULT_ASSISTANT_DAILY_LIMIT = 100;

export function getAssistantDailyLimit() {
  const parsed = Number.parseInt(process.env.ASSISTANT_DAILY_LIMIT ?? "", 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ASSISTANT_DAILY_LIMIT;
}

/** El contador se reinicia a las 00:00 de Caracas. */
export function buildUsage(used: number, today: string): AssistantUsage {
  return {
    limit: getAssistantDailyLimit(),
    resetsAt: caracasDateToUtcRange(today).endUtcExclusive,
    used,
  };
}
