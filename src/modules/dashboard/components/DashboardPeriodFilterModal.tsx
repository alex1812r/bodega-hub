"use client";

import { Button } from "@/shared/components/Button";
import { Modal } from "@/shared/components/Modal";
import { cn } from "@/shared/utils/cn";

type PeriodOption = {
  days: number;
  label: string;
};

type DashboardPeriodFilterModalProps = {
  description: string;
  draftPeriodDays: number;
  onApply: () => void;
  onDraftPeriodChange: (days: number) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  periods: readonly PeriodOption[];
  title: string;
};

export function DashboardPeriodFilterModal({
  description,
  draftPeriodDays,
  onApply,
  onDraftPeriodChange,
  onOpenChange,
  open,
  periods,
  title,
}: DashboardPeriodFilterModalProps) {
  return (
    <Modal description={description} onOpenChange={onOpenChange} open={open} title={title}>
      <ul className="space-y-1">
        {periods.map((period) => (
          <li key={period.days}>
            <button
              className={cn(
                "w-full rounded-lg px-3 py-2 text-left text-sm transition-colors",
                draftPeriodDays === period.days
                  ? "bg-primary/10 font-medium text-primary"
                  : "text-foreground hover:bg-surface-container-low",
              )}
              onClick={() => onDraftPeriodChange(period.days)}
              type="button"
            >
              {period.label}
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={() => onOpenChange(false)} variant="secondary">
          Cancelar
        </Button>
        <Button onClick={onApply} variant="primary">
          Aplicar
        </Button>
      </div>
    </Modal>
  );
}
