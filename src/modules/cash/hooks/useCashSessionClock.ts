"use client";

import { useEffect, useState } from "react";

import {
  cashSessionRemainingMs,
  formatCashSessionRemaining,
  isCashSessionExpired,
} from "../utils/cashSessionDeadline";

const TICK_MS = 30_000;

export function useCashSessionClock(openedAt?: string | null) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  if (!openedAt) {
    return {
      expired: false,
      now,
      remainingLabel: null,
      remainingMs: 0,
    };
  }

  const remainingMs = cashSessionRemainingMs(openedAt, now);
  return {
    expired: isCashSessionExpired(openedAt, now),
    now,
    remainingLabel: formatCashSessionRemaining(remainingMs),
    remainingMs,
  };
}
