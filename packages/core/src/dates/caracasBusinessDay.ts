import { toAmericaCaracasDateKey } from "./dateCaracas";

export const BUSINESS_TIMEZONE = "America/Caracas";

function blankToNull(value: string | null | undefined) {
  if (value == null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Calendar arithmetic on YYYY-MM-DD without UTC day-shift. */
export function shiftIsoDate(isoDate: string, days: number) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, (month ?? 1) - 1, (day ?? 1) + days, 12, 0, 0));
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd}`;
}

/** `[date 00:00 Caracas, next day 00:00 Caracas)` as UTC instants. */
export function caracasDateToUtcRange(isoDate: string) {
  return {
    endUtcExclusive: `${shiftIsoDate(isoDate, 1)}T04:00:00.000Z`,
    startUtc: `${isoDate}T04:00:00.000Z`,
  };
}

/** Inclusive calendar `from`/`to` → UTC half-open bounds. Empty strings are ignored. */
export function caracasDateRangeToUtcBounds(from?: string | null, to?: string | null) {
  const fromDate = blankToNull(from);
  const toDate = blankToNull(to);

  return {
    endUtcExclusive: toDate ? `${shiftIsoDate(toDate, 1)}T04:00:00.000Z` : null,
    startUtc: fromDate ? `${fromDate}T04:00:00.000Z` : null,
  };
}

export function isUtcTimestampInCaracasDate(isoTimestamp: string, isoDate: string) {
  const { endUtcExclusive, startUtc } = caracasDateToUtcRange(isoDate);
  const time = new Date(isoTimestamp).getTime();

  return time >= new Date(startUtc).getTime() && time < new Date(endUtcExclusive).getTime();
}

export function isUtcTimestampInCaracasDateRange(
  isoTimestamp: string,
  from?: string | null,
  to?: string | null,
) {
  const { endUtcExclusive, startUtc } = caracasDateRangeToUtcBounds(from, to);
  const time = new Date(isoTimestamp).getTime();

  if (startUtc && time < new Date(startUtc).getTime()) {
    return false;
  }

  if (endUtcExclusive && time >= new Date(endUtcExclusive).getTime()) {
    return false;
  }

  return true;
}

export function applyCreatedAtCaracasRange<
  T extends {
    gte: (column: string, value: string) => T;
    lt: (column: string, value: string) => T;
  },
>(query: T, from: string | null | undefined, to: string | null | undefined) {
  const { endUtcExclusive, startUtc } = caracasDateRangeToUtcBounds(from, to);
  let next = query;

  if (startUtc) {
    next = next.gte("created_at", startUtc);
  }

  if (endUtcExclusive) {
    next = next.lt("created_at", endUtcExclusive);
  }

  return next;
}

export function getCaracasIsoDate(now: Date = new Date()) {
  return toAmericaCaracasDateKey(now.toISOString());
}

export function toCaracasDateKey(isoTimestamp: string) {
  return toAmericaCaracasDateKey(isoTimestamp);
}

export function formatCaracasDateTime(isoTimestamp: string) {
  return new Intl.DateTimeFormat("es-VE", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric",
  }).format(new Date(isoTimestamp));
}
