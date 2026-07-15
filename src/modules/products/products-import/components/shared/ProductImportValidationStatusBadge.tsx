import { AlertCircle, CheckCircle, XCircle } from "lucide-react";

import { cn } from "@/shared/utils/cn";

import type { ProductImportValidationStatus } from "../../types";

type ProductImportValidationStatusBadgeProps = {
  status: ProductImportValidationStatus;
  title?: string;
};

const LABELS: Record<ProductImportValidationStatus, string> = {
  valid: "Válido",
  warning: "Advertencia",
  error: "Error",
};

export function ProductImportValidationStatusBadge({
  status,
  title,
}: ProductImportValidationStatusBadgeProps) {
  const Icon =
    status === "valid" ? CheckCircle : status === "warning" ? AlertCircle : XCircle;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide",
        status === "valid" &&
          "bg-secondary-container/40 text-on-secondary-container",
        status === "warning" &&
          "bg-tertiary-container/40 text-on-tertiary-container",
        status === "error" && "bg-error-container/50 text-error",
      )}
      title={title}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {LABELS[status]}
    </span>
  );
}
