import type { PurchaseStatus } from "@/shared/mocks/erp-data";
import { cn } from "@/shared/utils/cn";

import { getPurchaseInfoBanner } from "../utils/purchaseDetailLabels";

type PurchaseDetailInfoBannerProps = {
  createdAt: string;
  notes?: string;
  status: PurchaseStatus;
  updatedAt?: string;
};

export function PurchaseDetailInfoBanner({
  createdAt,
  notes,
  status,
  updatedAt,
}: PurchaseDetailInfoBannerProps) {
  const content = getPurchaseInfoBanner(status, { createdAt, notes, updatedAt });
  const Icon = content.icon;
  const isAlert = status === "cancelado" || status === "devuelto";

  return (
    <aside
      className={cn(
        "flex items-start gap-4 rounded-r-lg border-l-4 bg-surface-container-high p-4 shadow-sm",
        isAlert ? "border-destructive" : "border-primary",
      )}
      role="note"
    >
      <Icon
        aria-hidden
        className={cn(
          "mt-0.5 size-5 shrink-0",
          isAlert ? "text-destructive" : "text-primary",
        )}
      />
      <div className="min-w-0">
        <h4 className="text-sm font-semibold text-foreground">{content.title}</h4>
        <p className="mt-1 text-sm text-on-surface-variant">{content.description}</p>
      </div>
    </aside>
  );
}
