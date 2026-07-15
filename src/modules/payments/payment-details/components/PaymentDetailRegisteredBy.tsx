"use client";

import { isDevToolkitEnabledUi } from "@/lib/api/dataSourceUi";

export const MOCK_PAYMENT_REGISTERED_BY = {
  initials: "AJ",
  name: "A. Jiménez",
} as const;

export function PaymentDetailRegisteredBy() {
  if (!isDevToolkitEnabledUi()) {
    return null;
  }

  const user = MOCK_PAYMENT_REGISTERED_BY;

  return (
    <div className="flex flex-col gap-1 md:col-span-2">
      <span className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
        Registrado por
      </span>
      <div className="mt-1 flex items-center gap-2">
        <div
          aria-hidden
          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-container-high text-xs font-semibold text-on-surface"
        >
          {user.initials}
        </div>
        <span className="text-sm font-medium text-foreground">{user.name}</span>
      </div>
    </div>
  );
}
