"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { cn } from "@/shared/utils/cn";

type InventorySkuCellProps = {
  className?: string;
  sku: string;
};

export function InventorySkuCell({ className, sku }: InventorySkuCellProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(sku);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className={cn("flex min-w-0 max-w-[5.5rem] items-center gap-0.5", className)}>
      <span
        className="min-w-0 flex-1 truncate font-mono text-[13px] leading-[18px] text-outline"
        title={sku}
      >
        {sku}
      </span>
      <button
        aria-label={copied ? "SKU copiado" : `Copiar SKU ${sku}`}
        className="shrink-0 rounded p-0.5 text-outline transition-colors hover:bg-surface-container hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => void handleCopy()}
        type="button"
      >
        {copied ? (
          <Check aria-hidden className="size-3.5 text-primary" />
        ) : (
          <Copy aria-hidden className="size-3.5" />
        )}
      </button>
    </div>
  );
}
