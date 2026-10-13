import { AlertTriangle, Minus, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";

import { Badge } from "@/shared/components/Badge";
import { cn } from "@/shared/utils/cn";
import {
  marginBand,
  type MarginBand,
  type MarginThresholds,
  markupPct,
} from "@/shared/utils/pricing";

export const MARGIN_BADGE_TITLE = "Ganancia sobre el costo (ya con IVA)";

type MarginBadgeSource =
  | { cost: number; pct?: never; price: number }
  | { cost?: never; pct: number | null; price?: never };

export type MarginBadgeProps = MarginBadgeSource & {
  className?: string;
  /** La banda bajó desde el último precio fijado: icono de advertencia y "Por revisar". */
  review?: boolean;
  size?: "sm" | "md";
  thresholds?: MarginThresholds;
};

const BAND_STYLE: Record<
  MarginBand,
  { icon: LucideIcon; label: string; variant: "danger" | "success" | "warning" }
> = {
  low: { icon: TrendingDown, label: "Ganancia baja", variant: "danger" },
  mid: { icon: Minus, label: "Ganancia media", variant: "warning" },
  high: { icon: TrendingUp, label: "Ganancia alta", variant: "success" },
};

const SIZE_CLASS = {
  sm: "gap-1",
  md: "gap-1.5 px-3 py-1 text-sm",
};

const ICON_CLASS = {
  sm: "size-3 shrink-0",
  md: "size-4 shrink-0",
};

/** % en formato español: coma decimal y hasta dos decimales ("24,99 %"). */
export function formatMarkupPct(pct: number) {
  return `${pct.toLocaleString("es-VE", { maximumFractionDigits: 2 })} %`;
}

export function MarginBadge({
  className,
  cost,
  pct,
  price,
  review = false,
  size = "sm",
  thresholds,
}: MarginBadgeProps) {
  const value = cost === undefined ? pct : markupPct(cost, price);

  if (value === null || !Number.isFinite(value)) {
    return (
      <Badge
        className={cn("whitespace-nowrap", SIZE_CLASS[size], className)}
        title={MARGIN_BADGE_TITLE}
        variant="default"
      >
        Sin costo
      </Badge>
    );
  }

  const band = marginBand(value, thresholds);
  const { icon, label, variant } = BAND_STYLE[band];
  const Icon = review ? AlertTriangle : icon;

  return (
    <Badge
      className={cn("whitespace-nowrap tabular-nums", SIZE_CLASS[size], className)}
      data-band={band}
      title={MARGIN_BADGE_TITLE}
      variant={variant}
    >
      <Icon aria-hidden className={ICON_CLASS[size]} />
      <span className="sr-only">{label}:</span>
      {review ? <span>Por revisar ·</span> : null}
      <span>{formatMarkupPct(value)}</span>
    </Badge>
  );
}
