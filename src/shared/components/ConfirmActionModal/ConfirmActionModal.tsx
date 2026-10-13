"use client";

import {
  ArrowRight,
  CircleCheck,
  Loader2,
  type LucideIcon,
  Minus,
  OctagonAlert,
  TriangleAlert,
} from "lucide-react";
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
import { type ScannerInputHandler, useScannerBurstGuard } from "./useScannerBurstGuard";

export type ConfirmActionEffectTone = "neutral" | "positive" | "warning" | "danger";

export type ConfirmActionEffect = {
  after?: string;
  before?: string;
  label: string;
  tone?: ConfirmActionEffectTone;
};

/**
 * Estado del efecto que se va a confirmar. Solo `ready` ofrece el botón de
 * confirmar; en los demás el diálogo es el mismo, pero de solo lectura.
 */
export type ConfirmActionStatus = "ready" | "loading" | "error" | "blocked";

export type ConfirmActionModalProps = {
  /**
   * Solo con `status="blocked"`: salidas alternativas (botones o enlaces) que se
   * muestran en el pie, después de «Cerrar».
   */
  blockedActions?: ReactNode;
  cancelLabel?: string;
  /** Contexto breve de la acción (p. ej. el documento afectado), encima de los efectos. */
  children?: ReactNode;
  /** Etiqueta del botón de cerrar cuando `status` no es `ready`. Por defecto, «Cerrar». */
  closeLabel?: string;
  /** Etiqueta explícita de la acción ("Anular venta"). Obligatoria: no hay valor por defecto. */
  confirmLabel: string;
  description: string;
  effects?: ConfirmActionEffect[];
  /** Mensaje de error del negocio; se muestra tal cual. */
  error?: string | null;
  isPending?: boolean;
  onConfirm: () => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
  /** Solo con `status="error"`: muestra «Reintentar» y lo llama al pulsarlo. */
  onRetry?: () => void;
  /**
   * Un lector de códigos disparó con el diálogo abierto y el foco fuera de un campo de
   * texto. Su Enter nunca pulsa un botón (ver `useScannerBurstGuard`); aquí llega lo
   * leído, por si la pantalla quiere hacer algo con ello. Sin esta prop, se ignora.
   */
  onScannerInput?: ScannerInputHandler;
  open: boolean;
  /** Alternativa a `effects` para casos a medida. */
  renderEffects?: () => ReactNode;
  /** Palabra que el usuario debe escribir para habilitar el botón (sin distinguir mayúsculas). */
  requireTypedConfirmation?: string;
  /**
   * Estado del efecto; por defecto `ready` (el comportamiento de siempre).
   * - `loading`: tras `children`, una zona de carga en lugar de los efectos.
   * - `error`: tras `children`, `statusMessage` como alerta y «Reintentar» si hay `onRetry`.
   * - `blocked`: `statusMessage` (el motivo, tal cual) como alerta, luego `children`
   *   y `blockedActions` en el pie.
   *
   * Fuera de `ready` no hay botón de confirmar, lista de efectos ni palabra
   * tecleada (lo escrito se borra), y «Cancelar» pasa a ser `closeLabel`.
   */
  status?: ConfirmActionStatus;
  /** Línea secundaria bajo `statusMessage` (p. ej. «No se ha cambiado nada.»). */
  statusHint?: string;
  /** Texto de la carga, mensaje del error o motivo del bloqueo, según `status`. */
  statusMessage?: string | null;
  title: string;
  variant?: "default" | "danger";
};

const toneBadgeVariant = {
  danger: "danger",
  neutral: "default",
  positive: "success",
  warning: "warning",
} as const satisfies Record<ConfirmActionEffectTone, string>;

// The tone must not depend on colour alone: each one has its own icon shape and
// a short prefix that only screen readers announce.
const toneMarker: Record<
  ConfirmActionEffectTone,
  { className: string; Icon: LucideIcon; srLabel: string }
> = {
  danger: {
    className: "text-red-600 dark:text-red-400",
    Icon: OctagonAlert,
    srLabel: "Efecto crítico:",
  },
  neutral: {
    className: "text-slate-500 dark:text-slate-400",
    Icon: Minus,
    srLabel: "Información:",
  },
  positive: {
    className: "text-emerald-600 dark:text-emerald-400",
    Icon: CircleCheck,
    srLabel: "Efecto favorable:",
  },
  warning: {
    className: "text-amber-600 dark:text-amber-400",
    Icon: TriangleAlert,
    srLabel: "Aviso:",
  },
};

const DEFAULT_STATUS_MESSAGE: Record<Exclude<ConfirmActionStatus, "ready">, string> = {
  blocked: "La acción no se puede ejecutar ahora.",
  error: "No se pudo calcular el efecto de la acción.",
  loading: "Calculando qué va a pasar…",
};

const alertClassName =
  "shrink-0 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300";

/** Safety net for synchronous handlers that end without any observable signal. */
const LOCK_SAFETY_TIMEOUT_MS = 1000;

type FocusReturnTarget = {
  /** Element that had focus when the modal opened. */
  element: HTMLElement | null;
  /** Button that opened the menu holding `element`, which survives the menu closing. */
  menuOpener: HTMLElement | null;
};

const noFocusReturnTarget: FocusReturnTarget = { element: null, menuOpener: null };

function captureFocusReturnTarget(): FocusReturnTarget {
  if (typeof document === "undefined") {
    return noFocusReturnTarget;
  }

  const element = document.activeElement;

  if (!(element instanceof HTMLElement) || element === document.body) {
    return noFocusReturnTarget;
  }

  const menu = element.closest('[role="menu"]');

  if (!menu) {
    return { element, menuOpener: null };
  }

  const labelledBy = menu.getAttribute("aria-labelledby");
  const menuOpener =
    (labelledBy ? document.getElementById(labelledBy) : null) ??
    document.querySelector('[aria-haspopup="menu"][aria-expanded="true"]');

  return { element, menuOpener: menuOpener instanceof HTMLElement ? menuOpener : null };
}

function restoreFocus({ element, menuOpener }: FocusReturnTarget) {
  const active = document.activeElement;

  // Only when closing left focus nowhere: never steal it from where the caller put it.
  if (active != null && active !== document.body && active.isConnected) {
    return;
  }

  const target = [element, menuOpener].find((candidate) => candidate?.isConnected);

  target?.focus();
}

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

export type ConfirmActionScrollAreaProps = {
  children: ReactNode;
  /** Límite de alto y relleno de la zona (p. ej. `max-h-56 px-3`). */
  className?: string;
  /** Id del título visible que da nombre a la zona cuando desborda. */
  labelledBy: string;
};

/**
 * Zona con scroll propio dentro de una confirmación: la de los efectos y las
 * listas con alto máximo del contexto (`children`). Cuando su contenido desborda
 * pasa a ser una parada de Tab con nombre, para poder leerla entera con flechas,
 * AvPág y Fin; si cabe, no añade nada al orden de foco.
 */
export function ConfirmActionScrollArea({
  children,
  className,
  labelledBy,
}: ConfirmActionScrollAreaProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [isScrollable, setIsScrollable] = useState(false);

  useEffect(() => {
    const viewport = viewportRef.current;

    if (!viewport || typeof ResizeObserver === "undefined") {
      return;
    }

    const measure = () => {
      setIsScrollable(viewport.scrollHeight > viewport.clientHeight + 1);
    };
    // The viewport stops resizing once it reaches its limit, so content that
    // changes afterwards is only seen through its mutations.
    const resizeObserver = new ResizeObserver(measure);
    const mutationObserver = new MutationObserver(measure);

    resizeObserver.observe(viewport);
    mutationObserver.observe(viewport, { characterData: true, childList: true, subtree: true });

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, []);

  return (
    <div
      aria-labelledby={isScrollable ? labelledBy : undefined}
      className={cn(
        "overflow-y-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        className,
      )}
      ref={viewportRef}
      role={isScrollable ? "group" : undefined}
      tabIndex={isScrollable ? 0 : undefined}
    >
      {children}
    </div>
  );
}

function EffectItem({ effect }: { effect: ConfirmActionEffect }) {
  const tone = effect.tone ?? "neutral";
  const marker = toneMarker[tone];
  const hasBefore = effect.before != null && effect.before !== "";
  const hasAfter = effect.after != null && effect.after !== "";

  return (
    <li
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-sm"
      data-tone={tone}
    >
      <span className="flex min-w-0 items-center gap-2 text-foreground">
        <marker.Icon
          aria-hidden="true"
          className={cn("h-4 w-4 shrink-0", marker.className)}
        />
        <span className="min-w-0 break-words">
          <span className="sr-only">{marker.srLabel} </span>
          {effect.label}
        </span>
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
  blockedActions,
  cancelLabel = "Cancelar",
  children,
  closeLabel = "Cerrar",
  confirmLabel,
  description,
  effects,
  error,
  isPending = false,
  onConfirm,
  onOpenChange,
  onRetry,
  onScannerInput,
  open,
  renderEffects,
  requireTypedConfirmation,
  status = "ready",
  statusHint,
  statusMessage,
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
  const lockedRef = useRef(false);
  const lockGenerationRef = useRef(0);
  const sawPendingRef = useRef(false);
  const safetyTimerRef = useRef<number | null>(null);

  useScannerBurstGuard(open, onScannerInput);

  const currentError = error || null;

  const [isLocked, setIsLocked] = useState(false);
  const [typedValue, setTypedValue] = useState("");
  // Error already present when the modal opened: it belongs to an earlier attempt.
  const [staleError, setStaleError] = useState(open ? currentError : null);
  const [focusReturnTarget, setFocusReturnTarget] = useState(() =>
    open ? captureFocusReturnTarget() : noFocusReturnTarget,
  );
  const [previousOpen, setPreviousOpen] = useState(open);
  const [previousPending, setPreviousPending] = useState(isPending);
  const [previousError, setPreviousError] = useState(currentError);
  const [previousStatus, setPreviousStatus] = useState(status);

  if (previousOpen !== open) {
    setPreviousOpen(open);
    setIsLocked(false);
    if (open) {
      setTypedValue("");
      setStaleError(currentError);
      setFocusReturnTarget(captureFocusReturnTarget());
    }
  } else if (staleError !== null && currentError !== staleError) {
    setStaleError(null);
  }

  if (previousPending !== isPending) {
    setPreviousPending(isPending);
    if (!isPending) {
      setIsLocked(false);
    }
  }

  if (previousError !== currentError) {
    setPreviousError(currentError);
    if (currentError !== null) {
      setIsLocked(false);
    }
  }

  if (previousStatus !== status) {
    setPreviousStatus(status);
    // The word was typed against an effect that is no longer on screen.
    if (status !== "ready") {
      setTypedValue("");
    }
  }

  // The ref blocks re-entry within the same tick; the state releases it from render.
  useEffect(() => {
    lockedRef.current = isLocked;
  });

  useEffect(() => {
    if (isPending) {
      sawPendingRef.current = true;
    }
  }, [isPending]);

  useEffect(
    () => () => {
      if (safetyTimerRef.current != null) {
        window.clearTimeout(safetyTimerRef.current);
      }
    },
    [],
  );

  // Modal keeps focus from jumping on close (POS), so hand it back to the trigger here.
  // Deferred: when this cleanup runs the dialog is still mounted and trapping focus.
  useEffect(() => {
    if (!open) {
      return;
    }

    return () => {
      window.setTimeout(() => restoreFocus(focusReturnTarget), 0);
    };
  }, [focusReturnTarget, open]);

  const isReady = status === "ready";
  const requiredWord = isReady ? (requireTypedConfirmation?.trim() ?? "") : "";
  const needsTypedConfirmation = requiredWord !== "";
  const isTypedConfirmed =
    !needsTypedConfirmation ||
    normalizeTypedWord(typedValue) === normalizeTypedWord(requiredWord);
  const isBusy = isPending || isLocked;
  const visibleError = currentError !== staleError ? currentError : null;
  const hasEffects =
    isReady && (renderEffects != null || (effects != null && effects.length > 0));
  const statusText = isReady ? null : statusMessage || DEFAULT_STATUS_MESSAGE[status];

  let initialFocusRef: RefObject<HTMLElement | null> = confirmRef;
  if (needsTypedConfirmation) {
    initialFocusRef = typedInputRef;
  } else if (variant === "danger" || !isReady) {
    initialFocusRef = cancelRef;
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && (isPending || lockedRef.current)) {
      return;
    }

    onOpenChange(nextOpen);
  }

  function handleConfirm() {
    if (!isReady || isPending || lockedRef.current || !isTypedConfirmed) {
      return;
    }

    const generation = lockGenerationRef.current + 1;

    lockGenerationRef.current = generation;
    lockedRef.current = true;
    sawPendingRef.current = false;
    setIsLocked(true);
    // From here on any error belongs to this opening, even with the same text.
    setStaleError(null);

    if (safetyTimerRef.current != null) {
      window.clearTimeout(safetyTimerRef.current);
      safetyTimerRef.current = null;
    }

    const release = () => {
      if (lockGenerationRef.current !== generation) {
        return;
      }

      lockedRef.current = false;
      setIsLocked(false);
    };

    let result: void | Promise<void>;

    try {
      result = onConfirm();
    } catch (confirmError) {
      release();
      throw confirmError;
    }

    if (isPromiseLike(result)) {
      // A rejection keeps the modal open so the action can be retried; the caller
      // surfaces the message through `error`.
      result.then(release, release);
      return;
    }

    // Synchronous handler: the lock is released from render when the modal closes,
    // `isPending` ends or a new error arrives. If none of that happens (the caller
    // bailed out silently), free it after a short wait.
    safetyTimerRef.current = window.setTimeout(() => {
      safetyTimerRef.current = null;

      if (!sawPendingRef.current) {
        release();
      }
    }, LOCK_SAFETY_TIMEOUT_MS);
  }

  return (
    <Modal
      bodyClassName="flex flex-col gap-4"
      description={description}
      footer={({ close }) => (
        <>
          <Button asChild variant="outline">
            <button disabled={isBusy} onClick={close} ref={cancelRef} type="button">
              {isReady ? cancelLabel : closeLabel}
            </button>
          </Button>
          {status === "blocked" ? blockedActions : null}
          {status === "error" && onRetry ? (
            <Button disabled={isBusy} onClick={onRetry} type="button">
              Reintentar
            </Button>
          ) : null}
          {isReady ? (
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
          ) : null}
        </>
      )}
      onOpenChange={handleOpenChange}
      open={open}
      title={title}
    >
      {/* Keyed by status: the control that had focus may be gone in the new state. */}
      <FocusOnMount key={status} targetRef={initialFocusRef} />

      {status === "blocked" ? (
        <>
          <p className={alertClassName} role="alert">
            {statusText}
          </p>
          {statusHint ? (
            <p className="shrink-0 text-sm text-on-surface-variant">{statusHint}</p>
          ) : null}
        </>
      ) : null}

      {children ? (
        <div className="shrink-0 text-sm text-on-surface-variant">{children}</div>
      ) : null}

      {status === "loading" ? (
        <div
          aria-live="polite"
          className="flex min-h-20 shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-border bg-surface-container-low px-3 py-6 text-center text-sm text-on-surface-variant"
          role="status"
        >
          <Loader2 aria-hidden="true" className="mb-1 h-5 w-5 animate-spin" />
          <p className="font-medium text-foreground">{statusText}</p>
          {statusHint ? <p>{statusHint}</p> : null}
        </div>
      ) : null}

      {status === "error" ? (
        <>
          <p className={alertClassName} role="alert">
            {statusText}
          </p>
          {statusHint ? (
            <p className="shrink-0 text-sm text-on-surface-variant">{statusHint}</p>
          ) : null}
        </>
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
          <ConfirmActionScrollArea className="min-h-0 flex-1 px-3 py-1" labelledBy={effectsTitleId}>
            {renderEffects ? (
              renderEffects()
            ) : (
              <ul aria-labelledby={effectsTitleId} className="divide-y divide-border">
                {effects?.map((effect, index) => (
                  <EffectItem effect={effect} key={`${index}-${effect.label}`} />
                ))}
              </ul>
            )}
          </ConfirmActionScrollArea>
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

      {visibleError ? (
        <p className={alertClassName} role="alert">
          {visibleError}
        </p>
      ) : null}
    </Modal>
  );
}
