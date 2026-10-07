"use client";

import { ArrowRight, Loader2 } from "lucide-react";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import {
  formControlClassName,
  formHelperClassName,
  formLabelClassName,
} from "@/shared/styles/form-controls";
import { cn } from "@/shared/utils/cn";

import { Badge } from "../Badge";
import { Button } from "../Button";
import { Modal } from "../Modal";

export type ConfirmActionEffectTone = "neutral" | "positive" | "warning" | "danger";

export type ConfirmActionEffect = {
  after?: string;
  before?: string;
  label: string;
  tone?: ConfirmActionEffectTone;
};

export type ConfirmActionModalProps = {
  cancelLabel?: string;
  /** Contexto breve de la acción (p. ej. el documento afectado), encima de los efectos. */
  children?: ReactNode;
  /** Etiqueta explícita de la acción ("Anular venta"). Obligatoria: no hay valor por defecto. */
  confirmLabel: string;
  description: string;
  effects?: ConfirmActionEffect[];
  /** Mensaje de error del negocio; se muestra tal cual. */
  error?: string | null;
  isPending?: boolean;
  onConfirm: () => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  /** Alternativa a `effects` para casos a medida. */
  renderEffects?: () => ReactNode;
  /** Palabra que el usuario debe escribir para habilitar el botón (sin distinguir mayúsculas). */
  requireTypedConfirmation?: string;
  title: string;
  variant?: "default" | "danger";
};

const toneBadgeVariant = {
  danger: "danger",
  neutral: "default",
  positive: "success",
  warning: "warning",
} as const satisfies Record<ConfirmActionEffectTone, string>;

const toneDotClassName: Record<ConfirmActionEffectTone, string> = {
  danger: "bg-red-500",
  neutral: "bg-slate-400",
  positive: "bg-emerald-500",
  warning: "bg-amber-500",
};

function normalizeTypedWord(value: string) {
  return value.trim().toLowerCase();
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

function FocusOnMount({ targetRef }: { targetRef: RefObject<HTMLElement | null> }) {
  useEffect(() => {
    targetRef.current?.focus();
  }, [targetRef]);

  return null;
}

function EffectItem({ effect }: { effect: ConfirmActionEffect }) {
  const tone = effect.tone ?? "neutral";
  const hasBefore = effect.before != null && effect.before !== "";
  const hasAfter = effect.after != null && effect.after !== "";

  return (
    <li
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-sm"
      data-tone={tone}
    >
      <span className="flex min-w-0 items-center gap-2 text-foreground">
        <span
          aria-hidden="true"
          className={cn("h-1.5 w-1.5 shrink-0 rounded-full", toneDotClassName[tone])}
        />
        <span className="min-w-0 break-words">{effect.label}</span>
      </span>
      {hasBefore || hasAfter ? (
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          {hasBefore ? (
            <span className="break-words text-muted-foreground dark:text-slate-400">
              {effect.before}
            </span>
          ) : null}
          {hasBefore && hasAfter ? (
            <>
              <ArrowRight
                aria-hidden="true"
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground dark:text-slate-400"
              />
              <span className="sr-only">pasa a</span>
            </>
          ) : null}
          {hasAfter ? <Badge variant={toneBadgeVariant[tone]}>{effect.after}</Badge> : null}
        </span>
      ) : null}
    </li>
  );
}

export function ConfirmActionModal({
  cancelLabel = "Cancelar",
  children,
  confirmLabel,
  description,
  effects,
  error,
  isPending = false,
  onConfirm,
  onOpenChange,
  open,
  renderEffects,
  requireTypedConfirmation,
  title,
  variant = "default",
}: ConfirmActionModalProps) {
  const baseId = useId();
  const effectsTitleId = `${baseId}-effects`;
  const typedInputId = `${baseId}-typed`;
  const typedHelpId = `${baseId}-typed-help`;

  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const typedInputRef = useRef<HTMLInputElement | null>(null);
  const runningRef = useRef(false);

  const [isRunning, setIsRunning] = useState(false);
  const [typedValue, setTypedValue] = useState("");
  const [previousOpen, setPreviousOpen] = useState(open);

  if (previousOpen !== open) {
    setPreviousOpen(open);
    if (open) {
      setTypedValue("");
    }
  }

  const requiredWord = requireTypedConfirmation?.trim() ?? "";
  const needsTypedConfirmation = requiredWord !== "";
  const isTypedConfirmed =
    !needsTypedConfirmation ||
    normalizeTypedWord(typedValue) === normalizeTypedWord(requiredWord);
  const isBusy = isPending || isRunning;
  const hasEffects = renderEffects != null || (effects != null && effects.length > 0);

  let initialFocusRef: RefObject<HTMLElement | null> = confirmRef;
  if (needsTypedConfirmation) {
    initialFocusRef = typedInputRef;
  } else if (variant === "danger") {
    initialFocusRef = cancelRef;
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && (isPending || runningRef.current)) {
      return;
    }

    onOpenChange(nextOpen);
  }

  function handleConfirm() {
    if (isPending || runningRef.current || !isTypedConfirmed) {
      return;
    }

    const result = onConfirm();

    if (!isPromiseLike(result)) {
      return;
    }

    runningRef.current = true;
    setIsRunning(true);

    const release = () => {
      runningRef.current = false;
      setIsRunning(false);
    };

    // A rejection keeps the modal open so the action can be retried; the caller
    // surfaces the message through `error`.
    result.then(release, release);
  }

  return (
    <Modal
      bodyClassName="flex flex-col gap-4"
      description={description}
      footer={({ close }) => (
        <>
          <Button asChild variant="outline">
            <button disabled={isBusy} onClick={close} ref={cancelRef} type="button">
              {cancelLabel}
            </button>
          </Button>
          <Button asChild variant={variant === "danger" ? "danger" : "primary"}>
            <button
              aria-busy={isBusy || undefined}
              disabled={isBusy || !isTypedConfirmed}
              onClick={handleConfirm}
              ref={confirmRef}
              type="button"
            >
              {isBusy ? (
                <>
                  <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                  Procesando...
                </>
              ) : (
                confirmLabel
              )}
            </button>
          </Button>
        </>
      )}
      onOpenChange={handleOpenChange}
      open={open}
      title={title}
    >
      <FocusOnMount targetRef={initialFocusRef} />

      {children ? (
        <div className="shrink-0 text-sm text-on-surface-variant">{children}</div>
      ) : null}

      {hasEffects ? (
        <section
          aria-labelledby={effectsTitleId}
          className="flex min-h-20 shrink flex-col overflow-hidden rounded-md border border-border bg-surface-container-low"
        >
          <h3
            className="shrink-0 border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-on-surface-variant"
            id={effectsTitleId}
          >
            Qué va a pasar
          </h3>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-1">
            {renderEffects ? (
              renderEffects()
            ) : (
              <ul aria-labelledby={effectsTitleId} className="divide-y divide-border">
                {effects?.map((effect, index) => (
                  <EffectItem effect={effect} key={`${index}-${effect.label}`} />
                ))}
              </ul>
            )}
          </div>
        </section>
      ) : null}

      {needsTypedConfirmation ? (
        <div className="shrink-0 space-y-2">
          <label className={formLabelClassName} htmlFor={typedInputId}>
            Palabra de confirmación
          </label>
          <input
            aria-describedby={typedHelpId}
            autoCapitalize="off"
            autoComplete="off"
            className={formControlClassName}
            disabled={isBusy}
            id={typedInputId}
            onChange={(event) => setTypedValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleConfirm();
              }
            }}
            ref={typedInputRef}
            spellCheck={false}
            type="text"
            value={typedValue}
          />
          <p className={formHelperClassName} id={typedHelpId}>
            Escribe <span className="font-mono font-semibold">{requiredWord}</span> para
            habilitar «{confirmLabel}». No distingue mayúsculas de minúsculas.
          </p>
        </div>
      ) : null}

      {error ? (
        <p
          className="shrink-0 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
