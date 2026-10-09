"use client";

import { MoreVertical } from "lucide-react";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { IconButton } from "@/shared/components/IconButton";
import { cn } from "@/shared/utils/cn";

export type ActionMenuItem = {
  disabled?: boolean;
  href?: string;
  label: string;
  onSelect?: () => void;
  variant?: "default" | "danger";
};

type ActionsMenuProps = {
  actions: ActionMenuItem[];
  label?: string;
  variant?: "ghost" | "secondary" | "outline" | "primary" | "danger";
};

/** Separación entre el disparador y el menú. */
const TRIGGER_GAP = 4;
/** Margen mínimo entre el menú y los bordes de la ventana. */
const VIEWPORT_MARGIN = 8;

type MenuPosition = {
  left: number;
  /** Solo cuando el menú no cabe entero ni debajo ni encima del disparador. */
  maxHeight?: number;
  top: number;
};

/**
 * Coloca el menú (`position: fixed`) debajo del disparador y alineado a su
 * borde derecho. Si no cabe debajo se abre hacia arriba; si tampoco cabe
 * arriba se acota al alto de la ventana (con desplazamiento propio). En
 * horizontal nunca se sale de la ventana.
 */
function getMenuPosition(
  trigger: DOMRect,
  menu: { height: number; width: number },
  viewport: { height: number; width: number },
): MenuPosition {
  const maxLeft = viewport.width - VIEWPORT_MARGIN - menu.width;
  const left = Math.max(VIEWPORT_MARGIN, Math.min(trigger.right - menu.width, maxLeft));
  const below = trigger.bottom + TRIGGER_GAP;
  const above = trigger.top - TRIGGER_GAP - menu.height;

  if (below + menu.height <= viewport.height - VIEWPORT_MARGIN) {
    return { left, top: below };
  }

  if (above >= VIEWPORT_MARGIN) {
    return { left, top: above };
  }

  const maxHeight = Math.max(0, viewport.height - VIEWPORT_MARGIN * 2);
  const maxTop = viewport.height - VIEWPORT_MARGIN - Math.min(menu.height, maxHeight);

  return { left, maxHeight, top: Math.max(VIEWPORT_MARGIN, Math.min(below, maxTop)) };
}

export function ActionsMenu({
  actions,
  label = "Abrir acciones",
  variant = "ghost",
}: ActionsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition>({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const floatingMenuRef = useRef<HTMLDivElement>(null);
  const actionClassName = (variant: ActionMenuItem["variant"]) =>
    cn(
      "flex w-full cursor-pointer rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800",
      variant === "danger" &&
        "text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950",
    );

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;

      if (
        !triggerRef.current?.contains(target) &&
        !floatingMenuRef.current?.contains(target)
      ) {
        setIsOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  // Antes de pintar: el menú no llega a verse en una posición provisional.
  useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }

    function updateMenuPosition() {
      const rect = triggerRef.current?.getBoundingClientRect();
      const menu = floatingMenuRef.current;

      if (!rect || !menu) {
        return;
      }

      const menuRect = menu.getBoundingClientRect();
      // Alto natural aunque ya esté acotado por `max-height` (contenido + bordes).
      const naturalHeight = menu.scrollHeight + menu.offsetHeight - menu.clientHeight;

      setMenuPosition(
        getMenuPosition(
          rect,
          { height: Math.max(menuRect.height, naturalHeight), width: menuRect.width },
          { height: window.innerHeight, width: window.innerWidth },
        ),
      );
    }

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);

    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [isOpen]);

  const menuContent = isOpen ? (
    <div
      className="fixed z-50 min-w-36 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-800 dark:bg-slate-900"
      ref={floatingMenuRef}
      role="menu"
      style={{
        left: menuPosition.left,
        maxHeight: menuPosition.maxHeight,
        top: menuPosition.top,
      }}
    >
      {actions.map((action) =>
        action.href && !action.disabled ? (
          <Link
            className={actionClassName(action.variant)}
            href={action.href}
            key={action.label}
            onClick={() => setIsOpen(false)}
            role="menuitem"
          >
            {action.label}
          </Link>
        ) : (
          <button
            className={actionClassName(action.variant)}
            disabled={action.disabled}
            key={action.label}
            onClick={() => {
              action.onSelect?.();
              setIsOpen(false);
            }}
            role="menuitem"
            type="button"
          >
            {action.label}
          </button>
        ),
      )}
    </div>
  ) : null;

  return (
    <div className="inline-flex" ref={triggerRef}>
      <IconButton
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={label}
        icon={<MoreVertical className="h-4 w-4" />}
        onClick={() => setIsOpen((current) => !current)}
        variant={variant}
      />

      {typeof document !== "undefined" && menuContent
        ? createPortal(menuContent, document.body)
        : null}
    </div>
  );
}
