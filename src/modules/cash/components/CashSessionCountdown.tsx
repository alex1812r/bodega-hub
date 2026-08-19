"use client";

import { useCashSessionClock } from "../hooks/useCashSessionClock";

type CashSessionCountdownProps = {
  openedAt: string;
};

export function CashSessionCountdown({ openedAt }: CashSessionCountdownProps) {
  const clock = useCashSessionClock(openedAt);

  if (clock.expired) {
    return (
      <p className="text-sm font-medium text-destructive">
        Jornada vencida. Cierra la caja para seguir vendiendo.
      </p>
    );
  }

  return (
    <p className="text-sm text-on-surface-variant">
      Cierre automático en <span className="font-semibold tabular-nums text-foreground">{clock.remainingLabel}</span>
      <span className="block text-xs">Tope: medianoche Caracas o 24 h (lo que ocurra primero).</span>
    </p>
  );
}
