import { Wallet } from "lucide-react";

import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";

import { PurchaseDetailInfoCard } from "./PurchaseDetailInfoCard";

type PurchaseDetailFinancialCardProps = {
  refRateVes: number;
  totalRef: number;
  totalVes: number;
};

export function PurchaseDetailFinancialCard({
  refRateVes,
  totalRef,
  totalVes,
}: PurchaseDetailFinancialCardProps) {
  return (
    <PurchaseDetailInfoCard icon={Wallet} title="Financiero">
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="text-sm text-on-surface-variant">Total REF:</span>
        <span className="text-sm font-semibold tabular-nums text-foreground">
          {formatRefUsd(totalRef)}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="text-sm text-on-surface-variant">Total VES:</span>
        <span className="text-sm font-semibold tabular-nums text-foreground">
          {formatVesBs(totalVes)}
        </span>
      </div>
      <p className="mt-2 border-t border-border/50 pt-2 text-xs text-outline dark:border-slate-800">
        Tasa: 1 REF = {refRateVes.toFixed(2)} VES
      </p>
    </PurchaseDetailInfoCard>
  );
}
