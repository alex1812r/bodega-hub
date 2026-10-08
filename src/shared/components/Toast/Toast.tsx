"use client";

import { AlertCircle, CheckCircle, Info, X } from "lucide-react";
import Link from "next/link";
import {
  createContext,
  type FocusEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@/shared/utils/cn";

import { Button } from "../Button";

export type ToastTone = "error" | "info" | "success";

/** Acción del aviso: un enlace interno (`next/link`) o un botón. Al usarla, el aviso se cierra. */
export type ToastAction =
  | { href: string; label: string }
  | { label: string; onClick: () => void };

export type ToastOptions = {
  action?: ToastAction;
  description?: string;
  /**
   * Milisegundos hasta el autocierre. Por defecto 6000; los de `tone: "error"`
   * no se cierran solos. `0`, negativo o `Infinity`: no se cierra solo.
   */
  durationMs?: number;
  title: string;
  /** Por defecto `"info"`. `"error"` se anuncia como `alert` (assertive); el resto como `status` (polite). */
  tone?: ToastTone;
};

export type ToastController = {
  /** Cierra un aviso por el id que devolvió `showToast`. Un id desconocido no hace nada. */
  dismiss: (id: string) => void;
  /** Muestra un aviso y devuelve su id (`""` si no hay `ToastProvider`). */
  showToast: (options: ToastOptions) => string;
};

type ToastRecord = ToastOptions & { id: string };

export const TOAST_DEFAULT_DURATION_MS = 6000;
/** Avisos visibles a la vez: al llegar otro se descarta el más antiguo. */
export const TOAST_STACK_LIMIT = 3;

const NOOP_CONTROLLER: ToastController = {
  dismiss: () => undefined,
  showToast: () => "",
};

const ToastContext = createContext<ToastController>(NOOP_CONTROLLER);

/**
 * Avisos breves que no interrumpen (regla 12 del plan de UX: nada de `alert`).
 *
 * Fuera de un `ToastProvider` devuelve un controlador que no hace nada (no
 * lanza): un componente que avisa se puede montar suelto en un test o una
 * story sin envolverlo. La app y Storybook lo montan en `AppProviders`.
 */
export function useToast(): ToastController {
  return useContext(ToastContext);
}

const toneStyles: Record<ToastTone, { accent: string; icon: typeof Info; iconColor: string }> = {
  error: {
    accent: "border-l-red-600 dark:border-l-red-400",
    icon: AlertCircle,
    iconColor: "text-red-600 dark:text-red-400",
  },
  info: {
    accent: "border-l-indigo-600 dark:border-l-indigo-400",
    icon: Info,
    iconColor: "text-indigo-600 dark:text-indigo-400",
  },
  success: {
    accent: "border-l-emerald-600 dark:border-l-emerald-400",
    icon: CheckCircle,
    iconColor: "text-emerald-600 dark:text-emerald-400",
  },
};

const actionClassName =
  "inline-flex shrink-0 cursor-pointer sm:mt-1 rounded-sm text-sm font-semibold text-indigo-700 underline underline-offset-2 hover:text-indigo-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:text-indigo-300 dark:hover:text-indigo-200";

/**
 * Aviso que se ve en pantalla estrecha, donde solo cabe uno sin tapar el modal
 * abierto: el error más reciente y, si no hay errores, el aviso más reciente.
 */
function pickNarrowScreenToastId(toasts: ToastRecord[]) {
  const errors = toasts.filter((toast) => toast.tone === "error");

  return (errors.at(-1) ?? toasts.at(-1))?.id;
}

function ToastItem({
  isHiddenOnNarrowScreen,
  onDismiss,
  toast,
}: {
  /** Sigue montado (su autocierre corre) y visible desde `sm`. */
  isHiddenOnNarrowScreen: boolean;
  onDismiss: (id: string) => void;
  toast: ToastRecord;
}) {
  const tone = toast.tone ?? "info";
  const durationMs = toast.durationMs ?? (tone === "error" ? 0 : TOAST_DEFAULT_DURATION_MS);
  const autoCloses = Number.isFinite(durationMs) && durationMs > 0;
  const [isHovered, setIsHovered] = useState(false);
  const [hasFocus, setHasFocus] = useState(false);
  const isPaused = isHovered || hasFocus;
  // Lo que falta por correr: al pausar se descuenta lo ya transcurrido.
  const remainingMsRef = useRef(durationMs);
  const { accent, icon: Icon, iconColor } = toneStyles[tone];
  const action = toast.action;

  useEffect(() => {
    if (!autoCloses || isPaused) {
      return;
    }

    const startedAt = Date.now();
    const timer = window.setTimeout(() => onDismiss(toast.id), remainingMsRef.current);

    return () => {
      window.clearTimeout(timer);
      remainingMsRef.current = Math.max(0, remainingMsRef.current - (Date.now() - startedAt));
    };
  }, [autoCloses, isPaused, onDismiss, toast.id]);

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setHasFocus(false);
    }
  }

  return (
    <div
      className={cn(
        "pointer-events-auto mb-2 flex w-full items-start gap-3 rounded-lg border border-l-4 border-slate-200 bg-white p-2 shadow-lg sm:p-3 dark:border-slate-700 dark:bg-slate-900",
        "transition-[opacity,translate] duration-200 motion-reduce:transition-none starting:-translate-y-2 starting:opacity-0",
        accent,
        isHiddenOnNarrowScreen && "max-sm:hidden",
      )}
      data-toast-tone={tone}
      onBlur={handleBlur}
      onFocus={() => setHasFocus(true)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <Icon aria-hidden className={cn("mt-0.5 size-5 shrink-0", iconColor)} />
      {/* Estrecha: texto y acción en fila, y texto recortado, para acotar la altura (≤ 88 px). */}
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:block">
        <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          <p className="line-clamp-2 text-sm leading-[1.125rem] font-semibold text-slate-950 sm:line-clamp-none sm:leading-5 dark:text-slate-100">
            {toast.title}
          </p>
          {toast.description ? (
            <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-slate-600 sm:line-clamp-none sm:text-sm sm:leading-5 dark:text-slate-300">
              {toast.description}
            </p>
          ) : null}
        </div>
        {action && "href" in action ? (
          <Link className={actionClassName} href={action.href} onClick={() => onDismiss(toast.id)}>
            {action.label}
          </Link>
        ) : null}
        {action && "onClick" in action ? (
          <button
            className={actionClassName}
            onClick={() => {
              action.onClick();
              onDismiss(toast.id);
            }}
            type="button"
          >
            {action.label}
          </button>
        ) : null}
      </div>
      <Button
        aria-label="Cerrar aviso"
        className="h-7 w-7 shrink-0 p-0"
        onClick={() => onDismiss(toast.id)}
        variant="ghost"
      >
        <X aria-hidden className="size-4" />
      </Button>
    </div>
  );
}

function subscribeToNothing() {
  return () => undefined;
}

/**
 * Un `Modal` abierto se cierra con cualquier `pointerdown` que llegue al
 * documento desde fuera de su contenido. Los avisos viven fuera: el evento se
 * corta aquí para que pulsar "Cerrar" o la acción no cierre el modal de debajo.
 */
function keepPointerDownFromDismissingModals(viewport: HTMLDivElement) {
  function stop(event: Event) {
    event.stopPropagation();
  }

  viewport.addEventListener("pointerdown", stop);

  return () => viewport.removeEventListener("pointerdown", stop);
}

function ToastViewport({
  onDismiss,
  toasts,
}: {
  onDismiss: (id: string) => void;
  toasts: ToastRecord[];
}) {
  // El portal necesita `document`: en el servidor y en la hidratación no se pinta.
  const isClient = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );

  if (!isClient) {
    return null;
  }

  const narrowScreenToastId = pickNarrowScreenToastId(toasts);
  const renderItems = (items: ToastRecord[]) =>
    items.map((toast) => (
      <ToastItem
        isHiddenOnNarrowScreen={toast.id !== narrowScreenToastId}
        key={toast.id}
        onDismiss={onDismiss}
        toast={toast}
      />
    ));

  // Las dos regiones existen siempre (vacías): un lector de pantalla solo
  // anuncia lo que se añade a una región viva que ya estaba en la página, y el
  // `Modal` no oculta con `aria-hidden` los nodos que llevan `aria-live`.
  // Arriba a la derecha: no tapa el pie de los modales ni el botón principal
  // del POS. `z-[80]`: por encima del overlay de `Modal` (z-50).
  // Por debajo de `sm` el `Modal` es una hoja inferior de `max-h-[90vh]`: deja
  // libre el 10 % de arriba (84 px a 390 × 844; la X empieza en y ≈ 101). Ahí va
  // el aviso, pegado al borde (`top-1`) y de ≤ 88 px, sin tocar cabecera ni pie.
  return createPortal(
    <div
      className="pointer-events-none fixed inset-x-0 top-1 z-[80] mx-auto flex w-[calc(100%-2rem)] max-w-sm flex-col sm:top-4 sm:left-auto sm:right-4 sm:mx-0"
      data-toast-viewport=""
      ref={keepPointerDownFromDismissingModals}
    >
      <div aria-atomic="false" aria-live="assertive" role="alert">
        {renderItems(toasts.filter((toast) => toast.tone === "error"))}
      </div>
      <div aria-atomic="false" aria-live="polite" role="status">
        {renderItems(toasts.filter((toast) => toast.tone !== "error"))}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Proveedor de avisos. Va una vez, en la raíz (`AppProviders`).
 *
 * - Apila hasta `TOAST_STACK_LIMIT` avisos; los de error se pintan arriba.
 * - Pantalla estrecha (< `sm`): se ve uno solo (el error más reciente o, sin
 *   errores, el más reciente), con título y descripción recortados a 2 líneas
 *   y la acción al lado. Los demás siguen su cuenta y aparecen al cerrarse él.
 *   Un aviso que llega mientras se ve un error no se anuncia hasta mostrarse.
 * - Autocierre a los 6 s (los de error no se cierran solos), en pausa mientras
 *   el puntero o el foco están sobre el aviso.
 * - No mueve el foco. Límite conocido: con un `Modal` abierto el aviso se ve y
 *   se puede pulsar con el puntero, pero el teclado no llega a él. El diálogo
 *   de Radix cicla Tab dentro de su contenido y devuelve el foco que sale;
 *   saltárselo exige cambiar `Modal` o añadir un atajo propio. Por eso la
 *   acción de un aviso no puede ser el único camino a nada: lo que enlaza
 *   ("Ver") debe seguir alcanzable por la pantalla una vez cerrado el modal.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const lastIdRef = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback((options: ToastOptions) => {
    lastIdRef.current += 1;

    const id = `toast-${lastIdRef.current}`;

    setToasts((current) => [...current, { ...options, id }].slice(-TOAST_STACK_LIMIT));

    return id;
  }, []);

  const controller = useMemo(() => ({ dismiss, showToast }), [dismiss, showToast]);

  return (
    <ToastContext.Provider value={controller}>
      {children}
      <ToastViewport onDismiss={dismiss} toasts={toasts} />
    </ToastContext.Provider>
  );
}
