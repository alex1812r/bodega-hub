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
export const reserveTextClassName = "before:content-[attr(data-reserve)]";

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
    // REP17-01 (D70(a)): elegida otra con una tasa ya escrita, se puede volver a ella.
    const typed = rate.manual !== undefined;
    if (!manualInput && !printedDiffers && !typed) {
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
      ...(manualInput || typed
        ? [{ checked: manualInput, choice: "manual" as const, label: "Escribir la tasa", manualRate: rate.manual }]
        : []),
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
 * REP17-01 (D70(a)): zonas del aviso, de arriba abajo. Abierta sin tasa del día, lo que su llegada ofrece («Tasa de
 * hoy» y, sin impresa, «Escribir la tasa») va en `arrival`, DEBAJO del campo de la tasa escrita: nunca encima.
 */
const SLOT_ORDER = ["paragraphs", "chips", "manual", "arrival"] as const;
type RateSlot = (typeof SLOT_ORDER)[number];

/** Lo de `view` repartido en sus zonas. */
type RateNoticeParts = { view: RateNoticeView; chips: RateChip[]; arrival: RateChip[] };

/**
 * `split` (abierta sin tasa del día): las opciones que trae la llegada van a `arrival`; las de antes (impresa y escribir
 * la tasa, con impresa) siguen en `chips`, donde ya estaban.
 */
function partsOf(view: RateNoticeView, split: boolean): RateNoticeParts {
  const chips = view.chips ?? [];
  const printedOffered = chips.some((chip) => chip.choice === "printed");
  const arrives = (chip: RateChip) => split && (chip.choice === "system" || (chip.choice === "manual" && !printedOffered));
  return { arrival: chips.filter(arrives), chips: chips.filter((chip) => !arrives(chip)), view };
}

function hasSlot(parts: RateNoticeParts, slot: RateSlot): boolean {
  switch (slot) {
    case "paragraphs":
      return parts.view.paragraphs.length > 0;
    case "chips":
      return parts.chips.length > 0;
    case "manual":
      return parts.view.manualInput;
    case "arrival":
      return parts.arrival.length > 0;
  }
}

/**
 * Caja del aviso: comparte las filas (`subgrid`) con las demás cajas de la celda (reservas y la de verdad), así cada
 * zona mide lo que la más alta de todas y lo que cambia en una no mueve las de debajo.
 */
const boxClassName =
  "col-start-1 grid grid-rows-subgrid gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300";
const chipsClassName = "flex flex-wrap gap-2";
const GROUP_LABEL = "Tasa para convertir los costos";

/**
 * Filas que ocupa una caja (desde la primera: todas las cajas se apilan en la misma celda) o, dentro de ella, el grupo de
 * opciones (a continuación del texto).
 */
function spanRows(count: number, fromFirst = false) {
  return { gridRow: `${fromFirst ? "1" : "auto"} / span ${count}` };
}

/**
 * REP15-01b: la caja de `parts` sin texto ni controles en el documento (el texto lo pinta CSS), con sus zonas en las
 * filas de `slots`. Va invisible en la misma celda que el aviso.
 */
function RateNoticeReserve({ parts, slots }: { parts: RateNoticeParts; slots: readonly RateSlot[] }) {
  const reserveChips = (chips: RateChip[]) => (
    <div className={chipsClassName}>
      {chips.map((chip) => (
        <span className={cn(choiceClassName, "inline-block", reserveTextClassName)} data-reserve={chip.label} key={chip.label} />
      ))}
    </div>
  );
  const zone = (slot: RateSlot) => {
    if (!hasSlot(parts, slot)) {
      return <div key={slot} />;
    }
    switch (slot) {
      case "paragraphs":
        return (
          <div className="flex flex-col gap-3" key={slot}>
            {parts.view.paragraphs.map((paragraph) => (
              <p className="flex items-start gap-2" key={paragraph.text}>
                <span className="mt-0.5 size-4 shrink-0" />
                <span className={reserveTextClassName} data-reserve={paragraph.text} />
              </p>
            ))}
          </div>
        );
      case "manual":
        return (
          <div className="max-w-56" key={slot}>
            <div className="space-y-2">
              <span className={cn(formLabelClassName, reserveTextClassName)} data-reserve="Tasa Bs por REF" />
              <div>
                <span className={cn(formControlClassName, "block")} />
              </div>
            </div>
          </div>
        );
      case "chips":
      case "arrival":
        return <div key={slot}>{reserveChips(parts[slot])}</div>;
    }
  };
  return (
    <div
      aria-hidden
      className={cn(boxClassName, parts.view.danger && dangerClassName, "invisible pointer-events-none")}
      data-layout-reserve
      inert
      style={spanRows(slots.length, true)}
    >
      {slots.map(zone)}
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
 * REP17-01 (D70(a)): y cada zona (texto, opciones, campo y lo que trae la llegada), el de la más alta: al llegar la del
 * día no se mueve ningún control del aviso; «Tasa de hoy» aparece debajo del campo, en su sitio ya reservado.
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
  // Con reservas la revisión se abrió sin tasa del día: lo que trae su llegada va debajo del campo.
  const split = reserve.length > 0;
  const view = rateNoticeView(state, systemRateArrivedLate);
  const parts = view ? partsOf(view, split) : null;
  // Una caja por contenido distinto (dos iguales miden lo mismo). En una reserva con tasa del día, esta llegó tarde.
  const reserved = new Map<string, RateNoticeParts>();
  for (const reserveState of reserve) {
    const reserveView = reserveState.usd.anomaly ? null : rateNoticeView(reserveState, reserveState.rate.system !== undefined);
    if (reserveView) {
      reserved.set(JSON.stringify(reserveView), partsOf(reserveView, split));
    }
  }
  const slots = SLOT_ORDER.filter((slot) =>
    [...reserved.values(), ...(parts ? [parts] : [])].some((item) => hasSlot(item, slot)),
  );
  // Filas de las opciones y del campo: todo lo que va tras el texto.
  const choiceSlots = slots.filter((slot) => slot !== "paragraphs");

  const chipButtons = (chips: RateChip[]) =>
    chips.map((chip) => (
      <ChoiceButton checked={chip.checked} key={chip.choice} onClick={() => choose(chip.choice, chip.manualRate)}>
        {chip.label}
      </ChoiceButton>
    ));
  const chipRow = (chips: RateChip[], key: RateSlot) => (
    <div className={chipsClassName} data-guarded-activation key={key}>
      {chipButtons(chips)}
    </div>
  );
  const choiceZone = (current: RateNoticeParts, slot: RateSlot) => {
    if (slot !== "manual") {
      return slot === "paragraphs" ? null : chipRow(current[slot], slot);
    }
    return current.view.manualInput ? (
      <div className="max-w-56 text-foreground" key={slot}>
        <NumberInput
          decimals={2}
          label="Tasa Bs por REF"
          min={0}
          onValueChange={(value) => choose("manual", value ?? undefined)}
          required
          value={rate.manual ?? null}
        />
      </div>
    ) : (
      <div key={slot} />
    );
  };
  const choices = (current: RateNoticeParts) => {
    const offered = current.view.chips !== null;
    if (split && choiceSlots.length > 0) {
      // Una sola elección: el grupo abarca las opciones de encima, el campo y las de debajo. Siempre el mismo elemento
      // (con opciones o sin ellas): al llegar la tasa del día el campo no se vuelve a montar ni pierde el foco.
      return (
        <div
          aria-label={offered ? GROUP_LABEL : undefined}
          className="grid grid-rows-subgrid gap-3"
          role={offered ? "radiogroup" : undefined}
          style={spanRows(choiceSlots.length)}
        >
          {choiceSlots.map((slot) => choiceZone(current, slot))}
        </div>
      );
    }
    if (!offered) {
      return choiceSlots.map((slot) => (slot === "manual" ? choiceZone(current, slot) : <div key={slot} />));
    }
    return choiceSlots.map((slot) =>
      slot === "chips" ? (
        <div aria-label={GROUP_LABEL} className={chipsClassName} data-guarded-activation key={slot} role="radiogroup">
          {chipButtons(current.chips)}
        </div>
      ) : (
        choiceZone(current, slot)
      ),
    );
  };

  return (
    <>
      {[...reserved].map(([key, reserveParts]) => (
        <RateNoticeReserve key={key} parts={reserveParts} slots={slots} />
      ))}
      {parts ? (
        <div className={cn(boxClassName, parts.view.danger && dangerClassName)} role={parts.view.role} style={spanRows(slots.length, true)}>
          {slots.includes("paragraphs") ? (
            <div className="flex flex-col gap-3">
              {parts.view.paragraphs.map((paragraph) => (
                <p
                  className="flex items-start gap-2"
                  data-testid={paragraph.ignored ? "invoice-review-rate-ignored" : undefined}
                  key={paragraph.text}
                >
                  <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
                  {paragraph.text}
                </p>
              ))}
            </div>
          ) : null}
          {choices(parts)}
        </div>
      ) : null}
    </>
  );
}
