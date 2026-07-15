"use client";

import { MoreVertical } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
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
};

export function ActionsMenu({ actions, label = "Abrir acciones" }: ActionsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 });
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

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function updateMenuPosition() {
      const rect = triggerRef.current?.getBoundingClientRect();

      if (!rect) {
        return;
      }

      setMenuPosition({
        left: rect.right,
        top: rect.bottom + 4,
      });
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
      className="fixed z-50 min-w-36 -translate-x-full rounded-lg border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-800 dark:bg-slate-900"
      ref={floatingMenuRef}
      role="menu"
      style={{
        left: menuPosition.left,
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
        variant="ghost"
      />

      {typeof document !== "undefined" && menuContent
        ? createPortal(menuContent, document.body)
        : null}
    </div>
  );
}
