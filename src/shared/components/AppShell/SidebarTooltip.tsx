"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/shared/utils/cn";

type SidebarTooltipProps = {
  children: ReactNode;
  className?: string;
  label: string;
  /**
   * `right` (por defecto) pinta el tooltip fuera del sidebar, a la derecha del
   * icono y con `position: fixed`, para que no lo recorte el riel con scroll.
   * `bottom` lo deja en flujo bajo el ancla: solo sirve donde quepa entero.
   */
  placement?: "bottom" | "right";
  show: boolean;
};

type FloatingPosition = { left: number; top: number };

const tooltipClassName =
  "pointer-events-none z-[60] whitespace-nowrap rounded-md bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-lg";

/** Separación entre el icono y el tooltip, en px. */
const FLOATING_GAP = 8;
/** Margen para que el tooltip (centrado en `top`) no se salga del viewport. */
const FLOATING_VIEWPORT_MARGIN = 20;

type FloatingRightTooltipProps = Pick<SidebarTooltipProps, "children" | "className" | "label">;

function FloatingRightTooltip({ children, className, label }: FloatingRightTooltipProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<FloatingPosition | null>(null);
  const isOpen = position !== null;

  const open = () => {
    const rect = anchorRef.current?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    const center = rect.top + rect.height / 2;

    setPosition({
      left: rect.right + FLOATING_GAP,
      top: Math.min(
        Math.max(center, FLOATING_VIEWPORT_MARGIN),
        window.innerHeight - FLOATING_VIEWPORT_MARGIN,
      ),
    });
  };
  const close = () => setPosition(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    // La posición se calcula una vez al mostrarse: si el riel hace scroll o
    // cambia el viewport, el tooltip se oculta en vez de quedar descolocado.
    const hide = () => setPosition(null);

    window.addEventListener("scroll", hide, { capture: true, passive: true });
    window.addEventListener("resize", hide);

    return () => {
      window.removeEventListener("scroll", hide, { capture: true });
      window.removeEventListener("resize", hide);
    };
  }, [isOpen]);

  return (
    <div
      className={cn("w-full min-w-0", className)}
      onBlur={close}
      onFocus={open}
      onMouseEnter={open}
      onMouseLeave={close}
      ref={anchorRef}
    >
      {children}
      {position
        ? createPortal(
            <span
              className={cn(tooltipClassName, "fixed -translate-y-1/2")}
              role="tooltip"
              style={position}
            >
              {label}
            </span>,
            document.body,
          )
        : null}
    </div>
  );
}

export function SidebarTooltip({
  children,
  className,
  label,
  placement = "right",
  show,
}: SidebarTooltipProps) {
  if (!show) {
    return <>{children}</>;
  }

  if (placement === "right") {
    return (
      <FloatingRightTooltip className={className} label={label}>
        {children}
      </FloatingRightTooltip>
    );
  }

  return (
    <div className={cn("group/sidebar-tip relative w-full min-w-0", className)}>
      {children}
      <span
        className={cn(
          tooltipClassName,
          "absolute top-full left-1/2 mt-2 -translate-x-1/2 opacity-0 transition-opacity group-hover/sidebar-tip:opacity-100 group-focus-within/sidebar-tip:opacity-100",
        )}
        role="tooltip"
      >
        {label}
      </span>
    </div>
  );
}
