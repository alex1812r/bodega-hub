"use client";

import { Button } from "@/shared/components/Button";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";
import { cn } from "@/shared/utils/cn";

type PeriodOption = {
  days?: number;
  key?: string;
  label: string;
};

type CustomRangeDraft = {
  from: string;
  max?: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  to: string;
};

type DashboardPeriodFilterModalProps = {
  applyDisabled?: boolean;
  customRange?: CustomRangeDraft;
  description: string;
  draftPeriodKey: string;
  onApply: () => void;
  onDraftPeriodKeyChange: (key: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  periods: readonly PeriodOption[];
  title: string;
};

function periodKey(period: PeriodOption) {
  return period.key ?? String(period.days ?? "");
}

export function DashboardPeriodFilterModal({
  applyDisabled = false,
  customRange,
  description,
  draftPeriodKey,
  onApply,
  onDraftPeriodKeyChange,
  onOpenChange,
  open,
  periods,
  title,
}: DashboardPeriodFilterModalProps) {
  const showCustomRange = Boolean(customRange) && draftPeriodKey === "rango";
  const rangeError =
    showCustomRange && customRange && customRange.from && customRange.to && customRange.from > customRange.to
      ? "La fecha desde no puede ser posterior a hasta."
      : undefined;

  return (
    <Modal description={description} onOpenChange={onOpenChange} open={open} title={title}>
      <ul className="space-y-1">
        {periods.map((period) => {
          const key = periodKey(period);

          return (
            <li key={key}>
              <button
                className={cn(
                  "w-full rounded-lg px-3 py-2 text-left text-sm transition-colors",
                  draftPeriodKey === key
                    ? "bg-primary/10 font-medium text-primary"
                    : "text-foreground hover:bg-surface-container-low",
                )}
                onClick={() => onDraftPeriodKeyChange(key)}
                type="button"
              >
                {period.label}
              </button>
            </li>
          );
        })}
      </ul>
      {showCustomRange && customRange ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Input
            label="Desde"
            max={customRange.max}
            onChange={(event) => customRange.onFromChange(event.target.value)}
            type="date"
            value={customRange.from}
          />
          <Input
            error={rangeError}
            label="Hasta"
            max={customRange.max}
            onChange={(event) => customRange.onToChange(event.target.value)}
            type="date"
            value={customRange.to}
          />
        </div>
      ) : null}
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={() => onOpenChange(false)} variant="secondary">
          Cancelar
        </Button>
        <Button disabled={applyDisabled} onClick={onApply} variant="primary">
          Aplicar
        </Button>
      </div>
    </Modal>
  );
}
