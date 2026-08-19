import { caracasDateToUtcRange, toCaracasDateKey } from "@/shared/utils/caracasBusinessDay";

export const CASH_SESSION_MAX_OPEN_MS = 24 * 60 * 60 * 1000;

export type CashSessionClosedReason = "manual" | "end_of_day" | "max_24h";
export type CashSessionAutoCloseReason = Exclude<CashSessionClosedReason, "manual">;

function endOfCaracasDayUtc(openedAt: string) {
  const caracasDate = toCaracasDateKey(openedAt);
  return new Date(caracasDateToUtcRange(caracasDate).endUtcExclusive);
}

function max24hUtc(openedAt: string) {
  return new Date(new Date(openedAt).getTime() + CASH_SESSION_MAX_OPEN_MS);
}

/** Deadline = min(medianoche Caracas del día de apertura, opened_at + 24 h). */
export function cashSessionDeadlineUtc(openedAt: string) {
  const endOfDay = endOfCaracasDayUtc(openedAt);
  const max24h = max24hUtc(openedAt);
  return endOfDay.getTime() <= max24h.getTime() ? endOfDay : max24h;
}

export function cashSessionAutoCloseReason(openedAt: string): CashSessionAutoCloseReason {
  const endOfDay = endOfCaracasDayUtc(openedAt);
  const max24h = max24hUtc(openedAt);
  return endOfDay.getTime() <= max24h.getTime() ? "end_of_day" : "max_24h";
}

export function isCashSessionExpired(openedAt: string, now: Date = new Date()) {
  return now.getTime() >= cashSessionDeadlineUtc(openedAt).getTime();
}

export function cashSessionRemainingMs(openedAt: string, now: Date = new Date()) {
  return Math.max(0, cashSessionDeadlineUtc(openedAt).getTime() - now.getTime());
}

export function formatCashSessionRemaining(remainingMs: number) {
  const totalSeconds = Math.floor(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours} h ${String(minutes).padStart(2, "0")} min`;
  }

  if (minutes > 0) {
    return `${minutes} min ${String(seconds).padStart(2, "0")} s`;
  }

  return `${seconds} s`;
}
