import { cn } from "@/shared/utils/cn";

type PaymentsCurrencyBadgeProps = {
  currency: "USD" | "VES";
};

export function PaymentsCurrencyBadge({ currency }: PaymentsCurrencyBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold",
        currency === "USD"
          ? "bg-primary-fixed-dim text-on-primary-fixed"
          : "bg-surface-container text-on-surface-variant border border-outline-variant/40",
      )}
    >
      {currency}
    </span>
  );
}
