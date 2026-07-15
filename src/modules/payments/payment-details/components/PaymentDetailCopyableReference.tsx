"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { cn } from "@/shared/utils/cn";

import { formatMaskedReference } from "../utils/paymentDetailLabels";

type PaymentDetailCopyableReferenceProps = {
  className?: string;
  referenceCode?: string;
};

export function PaymentDetailCopyableReference({
  className,
  referenceCode,
}: PaymentDetailCopyableReferenceProps) {
  const [copied, setCopied] = useState(false);
  const fullValue = referenceCode?.trim() ?? "";
  const displayValue = formatMaskedReference(referenceCode);
  const canCopy = fullValue.length > 0;

  async function handleCopy() {
    if (!canCopy) {
      return;
    }

    try {
      await navigator.clipboard.writeText(fullValue);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="rounded border border-outline-variant bg-surface-container-low px-2 py-1 font-mono text-sm text-on-surface-variant">
        {displayValue}
      </span>
      {canCopy ? (
        <button
          aria-label={copied ? "Copiado" : `Copiar referencia ${fullValue}`}
          className="rounded p-1 text-outline transition-colors hover:bg-surface-container hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => void handleCopy()}
          type="button"
        >
          {copied ? (
            <Check aria-hidden className="size-4 text-primary" />
          ) : (
            <Copy aria-hidden className="size-4" />
          )}
        </button>
      ) : null}
    </div>
  );
}
