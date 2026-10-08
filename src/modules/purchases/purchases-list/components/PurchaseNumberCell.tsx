"use client";

import { Check, Copy } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { cn } from "@/shared/utils/cn";

type PurchaseNumberCellProps = {
  className?: string;
  /** Detalle de la compra (con `returnTo`): el número es el enlace que lo abre. */
  href: string;
  purchaseNumber: string;
};

export function PurchaseNumberCell({
  className,
  href,
  purchaseNumber,
}: PurchaseNumberCellProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(purchaseNumber);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      <Link
        className="whitespace-nowrap rounded font-mono text-[13px] leading-[18px] text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        href={href}
      >
        {purchaseNumber}
      </Link>
      <button
        aria-label={copied ? "Número copiado" : `Copiar número ${purchaseNumber}`}
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
