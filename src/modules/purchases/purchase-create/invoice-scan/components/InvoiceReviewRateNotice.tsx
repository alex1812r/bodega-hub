"use client";

import { AlertTriangle, CheckCircle2, DollarSign } from "lucide-react";

import { Button } from "@/shared/components/Button";
import { NumberInput } from "@/shared/components/NumberInput";
import { cn } from "@/shared/utils/cn";

import {
  USD_ANOMALY_NOTICE,
  type InvoiceRateChoice,
  type InvoiceReviewAction,
  type InvoiceReviewState,
} from "../reviewModel";
import { formatRate } from "./invoiceReviewView";

export type InvoiceReviewRateNoticeProps = {
  state: InvoiceReviewState;
  onAction: (action: InvoiceReviewAction) => void;
};

const noticeClassName =
  "flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300";

export function ChoiceButton({
  checked,
  children,
  onClick,
}: {
  checked: boolean;
  children: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-checked={checked}
      className={cn(
        "h-9 cursor-pointer rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        checked
          ? "border-indigo-600 bg-indigo-600 text-white dark:border-indigo-500 dark:bg-indigo-500"
          : "border-outline bg-surface-container-lowest text-foreground hover:bg-surface-container-low",
      )}
      onClick={onClick}
      role="radio"
      type="button"
    >
      {children}
    </button>
  );
}

/**
 * Tasa y moneda de la revisión. D8 / 6.20: la impresa difiere > 2 % de la del día,
 * se elige "Tasa de hoy" o "Tasa de la factura". 6.7: sin tasa del día se usa la
 * impresa con aviso o se pide con `NumberInput`. 6.21: factura en dólares, banner
 * que exige aceptar explícitamente. SCN-UI-Q1: una impresa inverosímil no se ofrece
 * (`rate.ignoredWarning`) y una sin referencia con qué comprobarla se avisa en rojo.
 */
export function InvoiceReviewRateNotice({ onAction, state }: InvoiceReviewRateNoticeProps) {
  const { rate, usd } = state;
  const ignored = rate.ignoredWarning ? (
    <p className="flex items-start gap-2" data-testid="invoice-review-rate-ignored">
      <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
      {rate.ignoredWarning}
    </p>
  ) : null;

  if (usd.anomaly) {
    return usd.accepted ? (
      <div
        className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
        role="status"
      >
        <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0" />
        Factura en dólares aceptada: los costos se cargan como REF (USD = REF).
      </div>
    ) : (
      <div className={cn(noticeClassName, "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-300")} role="alert">
        <p className="flex items-start gap-2">
          <DollarSign aria-hidden className="mt-0.5 size-4 shrink-0" />
          {USD_ANOMALY_NOTICE}
        </p>
        <div>
          <Button onClick={() => onAction({ type: "acceptUsdAnomaly" })} size="sm" variant="danger">
            Sí, la factura está en dólares
          </Button>
        </div>
      </div>
    );
  }

  const choose = (choice: InvoiceRateChoice, manualRate?: number) =>
    onAction({ type: "setRateChoice", choice, ...(manualRate !== undefined ? { manualRate } : {}) });

  if (rate.system !== undefined) {
    if (!rate.warning || rate.printed === undefined) {
      return ignored ? (
        <div className={noticeClassName} role="status">
          {ignored}
        </div>
      ) : null;
    }
    return (
      <div className={noticeClassName} role="status">
        {ignored}
        <p className="flex items-start gap-2">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          {rate.warning}
        </p>
        <div aria-label="Tasa para convertir los costos" className="flex flex-wrap gap-2" role="radiogroup">
          <ChoiceButton checked={rate.choice === "system"} onClick={() => choose("system")}>
            {`Tasa de hoy (${formatRate(rate.system)})`}
          </ChoiceButton>
          <ChoiceButton checked={rate.choice === "printed"} onClick={() => choose("printed")}>
            {`Tasa de la factura (${formatRate(rate.printed)})`}
          </ChoiceButton>
        </div>
      </div>
    );
  }

  // 6.7: no hay tasa del día.
  return (
    <div
      className={cn(
        noticeClassName,
        rate.unverified && rate.choice === "printed"
          ? "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
          : null,
      )}
      role={rate.unverified && rate.choice === "printed" ? "alert" : "status"}
    >
      {ignored}
      {rate.notice ? (
        <p className="flex items-start gap-2">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          {rate.notice}
        </p>
      ) : null}
      {rate.printed !== undefined ? (
        <div aria-label="Tasa para convertir los costos" className="flex flex-wrap gap-2" role="radiogroup">
          <ChoiceButton checked={rate.choice === "printed"} onClick={() => choose("printed")}>
            {`Tasa de la factura (${formatRate(rate.printed)})`}
          </ChoiceButton>
          <ChoiceButton checked={rate.choice === "manual"} onClick={() => choose("manual", rate.manual)}>
            Escribir la tasa
          </ChoiceButton>
        </div>
      ) : null}
      {rate.choice === "manual" ? (
        <div className="max-w-56 text-foreground">
          <NumberInput
            decimals={2}
            label="Tasa Bs por REF"
            min={0}
            onValueChange={(value) => choose("manual", value ?? undefined)}
            required
            value={rate.manual ?? null}
          />
        </div>
      ) : null}
    </div>
  );
}
