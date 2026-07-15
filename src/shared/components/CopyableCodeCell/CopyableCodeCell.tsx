"use client";

import { Check, Copy } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { cn } from "@/shared/utils/cn";

type CopyableCodeCellProps = {
  className?: string;
  copyValue?: string;
  displayValue: string;
  fullValue?: string;
  href?: string;
  maxWidthClass?: string;
};

export function CopyableCodeCell({
  className,
  copyValue,
  displayValue,
  fullValue,
  href,
  maxWidthClass = "w-[5.75rem] max-w-[5.75rem]",
}: CopyableCodeCellProps) {
  const [copied, setCopied] = useState(false);
  const valueToCopy = copyValue ?? fullValue ?? displayValue;
  const tooltipValue = fullValue ?? valueToCopy;
  const canCopy = valueToCopy.length > 0 && displayValue !== "—";

  async function handleCopy() {
    if (!canCopy) {
      return;
    }

    try {
      await navigator.clipboard.writeText(valueToCopy);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const text = (
    <span
      className={cn(
        "block min-w-0 truncate font-mono text-[13px] leading-[18px]",
        href ? "text-primary" : "text-outline",
      )}
      title={tooltipValue}
    >
      {displayValue}
    </span>
  );

  return (
    <div className={cn("flex min-w-0 items-center gap-0.5 overflow-hidden", maxWidthClass, className)}>
      {href ? (
        <Link className="min-w-0 flex-1 overflow-hidden hover:underline" href={href}>
          {text}
        </Link>
      ) : (
        <div className="min-w-0 flex-1 overflow-hidden">{text}</div>
      )}
      {canCopy ? (
        <button
          aria-label={copied ? "Copiado" : `Copiar ${tooltipValue}`}
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
      ) : null}
    </div>
  );
}
