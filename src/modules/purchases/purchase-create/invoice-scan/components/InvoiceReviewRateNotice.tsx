"use client";

import { AlertTriangle, CheckCircle2, DollarSign } from "lucide-react";

import { Button } from "@/shared/components/Button";
import { NumberInput } from "@/shared/components/NumberInput";
import { formControlClassName, formLabelClassName } from "@/shared/styles/form-controls";
import { cn } from "@/shared/utils/cn";
import { formatVesBs } from "@/shared/utils/currency";

import {
  getRateNotice,
  USD_ANOMALY_NOTICE,
  type InvoiceRateChoice,
  type InvoiceReviewAction,
  type InvoiceReviewState,
} from "../reviewModel";
import { formatRate } from "./invoiceReviewView";

export type InvoiceReviewRateNoticeProps = {
  state: InvoiceReviewState;
  onAction: (action: InvoiceReviewAction) => void;
  /**
   * REP15-01b (D65(a)): estados que el aviso puede alcanzar sin que nadie actúe (antes y después de que llegue la
   * tasa del día). Su caja más alta se reserva, invisible, desde el primer render: que llegue la tasa no cambia el
   * alto del aviso ni mueve las filas.
   */
  reserve?: readonly InvoiceReviewState[];
  /** La tasa del día llegó con la revisión abierta: si ya no hay nada que elegir, se dice en el sitio reservado. */
  systemRateArrivedLate?: boolean;
};

const noticeClassName =
  "flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300";
const dangerClassName = "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-300";
const successClassName =
  "flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
const choiceClassName =
  "h-9 cursor-pointer rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
/** Texto de una caja de reserva: lo pinta CSS (`::before`), así no es texto del documento (ni lo leen ni lo hallan). */
const reserveTextClassName = "before:content-[attr(data-reserve)]";

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
        choiceClassName,
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

type RateChip = { label: string; checked: boolean; choice: InvoiceRateChoice; manualRate?: number };

/** Lo que pinta el aviso de tasa (sin la factura en dólares): párrafos, opciones y el campo de la tasa escrita. */
type RateNoticeView = {
  danger: boolean;
  role: "alert" | "status";
  paragraphs: { text: string; ignored?: boolean }[];
  chips: RateChip[] | null;
  manualInput: boolean;
};

/** D8 / 6.20 / 6.7 / SCN-UI-Q1: qué dice y qué ofrece el aviso con la tasa del día o sin ella. */
function rateNoticeView(state: InvoiceReviewState, systemRateArrivedLate: boolean): RateNoticeView | null {
  const { rate } = state;
  const ignored = rate.ignoredWarning ? [{ text: rate.ignoredWarning, ignored: true }] : [];
  // REP14-04 (B-p15B-2): el aviso dice la tasa en uso (escrita, impresa o la del día ya llegada).
  const notice = getRateNotice(state);
  const noticeParagraph = notice ? [{ text: notice }] : [];
  const manualInput = rate.choice === "manual";

  if (rate.system !== undefined) {
    // Con la tasa escrita antes de que llegara la del día, se respeta y se ofrece la de hoy.
    const printedDiffers = rate.warning !== undefined && rate.printed !== undefined;
    if (!manualInput && !printedDiffers) {
      // REP15-01b: la del día llegó tarde y no hay nada que elegir; el sitio reservado lo dice.
      const arrived = systemRateArrivedLate
        ? [{ text: `Llegó la tasa del día (${formatVesBs(rate.system)}): los costos se convierten con ella.` }]
        : [];
      const paragraphs = [...ignored, ...arrived];
      return paragraphs.length > 0
        ? { chips: null, danger: false, manualInput: false, paragraphs, role: "status" }
        : null;
    }
    const chips: RateChip[] = [
      { checked: rate.choice === "system", choice: "system", label: `Tasa de hoy (${formatRate(rate.system)})` },
      ...(rate.printed !== undefined
        ? [{ checked: rate.choice === "printed", choice: "printed" as const, label: `Tasa de la factura (${formatRate(rate.printed)})` }]
        : []),
      ...(manualInput ? [{ checked: true, choice: "manual" as const, label: "Escribir la tasa", manualRate: rate.manual }] : []),
    ];
    return {
      chips,
      danger: false,
      manualInput,
      paragraphs: [...ignored, ...(printedDiffers && rate.warning ? [{ text: rate.warning }] : []), ...noticeParagraph],
      role: "status",
    };
  }

  // 6.7: no hay tasa del día.
  const danger = rate.unverified === true && rate.choice === "printed";
  return {
    chips:
      rate.printed !== undefined
        ? [
            { checked: rate.choice === "printed", choice: "printed", label: `Tasa de la factura (${formatRate(rate.printed)})` },
            { checked: rate.choice === "manual", choice: "manual", label: "Escribir la tasa", manualRate: rate.manual },
          ]
        : null,
    danger,
    manualInput,
    paragraphs: [...ignored, ...noticeParagraph],
    role: danger ? "alert" : "status",
  };
}

/**
 * REP15-01b: la caja de `view` sin texto ni controles en el documento (el texto lo pinta CSS), del mismo alto que
 * la de verdad. Va invisible en la misma celda que el aviso: la celda mide lo que la más alta.
 */
function RateNoticeReserve({ view }: { view: RateNoticeView }) {
  return (
    <div
      aria-hidden
      className={cn(noticeClassName, view.danger && dangerClassName, "invisible pointer-events-none col-start-1 row-start-1")}
      data-layout-reserve
      inert
    >
      {view.paragraphs.map((paragraph) => (
        <p className="flex items-start gap-2" key={paragraph.text}>
          <span className="mt-0.5 size-4 shrink-0" />
          <span className={reserveTextClassName} data-reserve={paragraph.text} />
        </p>
      ))}
      {view.chips ? (
        <div className="flex flex-wrap gap-2">
          {view.chips.map((chip) => (
            <span className={cn(choiceClassName, "inline-block", reserveTextClassName)} data-reserve={chip.label} key={chip.label} />
          ))}
        </div>
      ) : null}
      {view.manualInput ? (
        <div className="max-w-56">
          <div className="space-y-2">
            <span className={cn(formLabelClassName, reserveTextClassName)} data-reserve="Tasa Bs por REF" />
            <div>
              <span className={cn(formControlClassName, "block")} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Tasa y moneda de la revisión. D8 / 6.20: la impresa difiere > 2 % de la del día,
 * se elige "Tasa de hoy" o "Tasa de la factura". 6.7: sin tasa del día se usa la
 * impresa con aviso o se pide con `NumberInput`. 6.21: factura en dólares, banner
 * que exige aceptar explícitamente. SCN-UI-Q1: una impresa inverosímil no se ofrece
 * (`rate.ignoredWarning`) y una sin referencia con qué comprobarla se avisa en rojo.
 * REP15-01b (D65(a)): con `reserve`, el aviso ocupa desde el primer render el alto del más alto de esos estados.
 */
export function InvoiceReviewRateNotice({
  onAction,
  reserve = [],
  state,
  systemRateArrivedLate = false,
}: InvoiceReviewRateNoticeProps) {
  const { rate, usd } = state;

  if (usd.anomaly) {
    return usd.accepted ? (
      <div className={successClassName} role="status">
        <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0" />
        Factura en dólares aceptada: los costos se cargan como REF (USD = REF).
      </div>
    ) : (
      <div className={cn(noticeClassName, dangerClassName)} role="alert">
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
  const view = rateNoticeView(state, systemRateArrivedLate);
  // Una caja por contenido distinto (dos iguales miden lo mismo).
  const reserved = new Map<string, RateNoticeView>();
  for (const reserveState of reserve) {
    const reserveView = reserveState.usd.anomaly ? null : rateNoticeView(reserveState, false);
    if (reserveView) {
      reserved.set(JSON.stringify(reserveView), reserveView);
    }
  }

  return (
    <>
      {[...reserved].map(([key, reserveView]) => (
        <RateNoticeReserve key={key} view={reserveView} />
      ))}
      {view ? (
        <div className={cn(noticeClassName, view.danger && dangerClassName, "col-start-1 row-start-1")} role={view.role}>
          {view.paragraphs.map((paragraph) => (
            <p
              className="flex items-start gap-2"
              data-testid={paragraph.ignored ? "invoice-review-rate-ignored" : undefined}
              key={paragraph.text}
            >
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
              {paragraph.text}
            </p>
          ))}
          {view.chips ? (
            <div
              aria-label="Tasa para convertir los costos"
              className="flex flex-wrap gap-2"
              data-guarded-activation
              role="radiogroup"
            >
              {view.chips.map((chip) => (
                <ChoiceButton
                  checked={chip.checked}
                  key={chip.choice}
                  onClick={() => choose(chip.choice, chip.manualRate)}
                >
                  {chip.label}
                </ChoiceButton>
              ))}
            </div>
          ) : null}
          {view.manualInput ? (
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
      ) : null}
    </>
  );
}
