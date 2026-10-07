"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, type ComponentProps } from "react";

import { Button } from "@/shared/components/Button";
import { GuardedLink } from "@/shared/components/ProcessGuard";
import { interceptProcessGuardNavigation } from "@/shared/hooks/useProcessGuard";
import { cn } from "@/shared/utils/cn";
import { RETURN_TO_PARAM, resolveReturnTo } from "@/shared/utils/returnTo";

type PageBackButtonBaseProps = {
  className?: string;
  label?: string;
  size?: ComponentProps<typeof Button>["size"];
  /**
   * Atajos `Esc` y `Alt+←` para volver. Por defecto activos con `fallbackHref`
   * e inactivos con el `href` heredado.
   */
  shortcuts?: boolean;
};

export type PageBackButtonProps = PageBackButtonBaseProps &
  (
    | {
        /** Destino cuando la URL no trae un `from` válido. */
        fallbackHref: string;
        href?: string;
      }
    | {
        fallbackHref?: undefined;
        /**
         * Forma heredada: enlace fijo a `href`, como antes. No lee `from` ni
         * activa atajos; al migrar la pantalla, cámbialo por `fallbackHref`.
         */
        href: string;
      }
  );

/** Capas que, abiertas, se quedan con `Esc`: el botón no debe actuar. */
const OPEN_OVERLAY_SELECTOR = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="listbox"]',
  '[role="menu"]',
  '[aria-modal="true"]',
  "dialog[open]",
  "[data-radix-popper-content-wrapper]",
  '[aria-haspopup][aria-expanded="true"]',
  '[role="combobox"][aria-expanded="true"]',
].join(",");

const EDITABLE_SELECTOR = [
  "input",
  "textarea",
  "select",
  '[contenteditable]:not([contenteditable="false"])',
  '[role="textbox"]',
  '[role="searchbox"]',
  '[role="combobox"]',
].join(",");

/**
 * Lo que había abierto o enfocado cuando la tecla llegó a `window`, antes de
 * que el diálogo que la consume se cierre y desaparezca del DOM.
 */
const blockedAtCapture = new WeakMap<Event, boolean>();

function isBackShortcut(event: KeyboardEvent) {
  if (event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.shiftKey) {
    return false;
  }

  return event.key === "Escape" ? !event.altKey : event.key === "ArrowLeft" && event.altKey;
}

function isEditable(node: EventTarget | null) {
  return node instanceof Element && node.closest(EDITABLE_SELECTOR) !== null;
}

function hasOpenOverlay() {
  const isVisible = (element: Element) => element.closest("[hidden]") === null;

  if (Array.from(document.querySelectorAll(OPEN_OVERLAY_SELECTOR)).some(isVisible)) {
    return true;
  }

  try {
    return document.querySelector(":popover-open") !== null;
  } catch {
    // Navegador sin la pseudoclase de popovers nativos.
    return false;
  }
}

function BackShortcuts({ href }: { href: string }) {
  const router = useRouter();

  useEffect(() => {
    function handleCapture(event: KeyboardEvent) {
      if (isBackShortcut(event)) {
        blockedAtCapture.set(
          event,
          isEditable(event.target) || isEditable(document.activeElement) || hasOpenOverlay(),
        );
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (
        !isBackShortcut(event) ||
        event.defaultPrevented ||
        blockedAtCapture.get(event) !== false
      ) {
        return;
      }

      // Evita el "atrás" nativo de `Alt+←` y que otro botón repita la navegación.
      event.preventDefault();

      if (!interceptProcessGuardNavigation(href)) {
        router.push(href);
      }
    }

    window.addEventListener("keydown", handleCapture, true);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleCapture, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [href, router]);

  return null;
}

type BackLinkProps = PageBackButtonBaseProps & { href: string };

function BackLink({ className, href, label = "Volver", shortcuts, size }: BackLinkProps) {
  return (
    <Button
      asChild
      className={cn("w-full gap-1 sm:w-auto", className)}
      size={size}
      variant="outline"
    >
      <GuardedLink aria-keyshortcuts={shortcuts ? "Escape Alt+ArrowLeft" : undefined} href={href}>
        <ArrowLeft aria-hidden className="size-4" />
        {label}
      </GuardedLink>
    </Button>
  );
}

/** Único punto que lee la URL: `useSearchParams` exige el límite de Suspense que pone `PageBackButton`. */
function ReturnAwareBackButton({
  fallbackHref,
  shortcuts,
  ...props
}: PageBackButtonBaseProps & { fallbackHref: string }) {
  const href = resolveReturnTo(useSearchParams().get(RETURN_TO_PARAM), fallbackHref);

  return (
    <>
      <BackLink {...props} href={href} shortcuts={shortcuts} />
      {shortcuts ? <BackShortcuts href={href} /> : null}
    </>
  );
}

/**
 * Botón "Volver" de un detalle. Vuelve a la URL de la lista de origen que
 * viaja en `?from=` (la añade `withReturnTo` en el enlace de la fila) si es una
 * ruta interna válida; si no, a `fallbackHref`. Es un enlace real: se puede
 * abrir en otra pestaña, y un guardia de proceso activo pregunta antes de salir.
 *
 * Con `fallbackHref`, `Esc` y `Alt+←` también vuelven, salvo con un diálogo,
 * menú o lista desplegable abiertos, con el foco en un campo editable o si otro
 * manejador ya consumió la tecla. `shortcuts={false}` los desactiva.
 *
 * Con solo `href` (forma heredada) es el enlace fijo de siempre: no lee la URL.
 *
 * El límite de Suspense que exige `useSearchParams` lo pone el propio componente.
 */
export function PageBackButton({
  className,
  fallbackHref,
  href,
  label,
  shortcuts,
  size,
}: PageBackButtonProps) {
  if (fallbackHref === undefined) {
    return (
      <>
        <BackLink className={className} href={href} label={label} shortcuts={shortcuts} size={size} />
        {shortcuts ? <BackShortcuts href={href} /> : null}
      </>
    );
  }

  const shortcutsEnabled = shortcuts ?? true;

  return (
    <Suspense
      fallback={
        <BackLink
          className={className}
          href={fallbackHref}
          label={label}
          shortcuts={shortcutsEnabled}
          size={size}
        />
      }
    >
      <ReturnAwareBackButton
        className={className}
        fallbackHref={fallbackHref}
        label={label}
        shortcuts={shortcutsEnabled}
        size={size}
      />
    </Suspense>
  );
}
