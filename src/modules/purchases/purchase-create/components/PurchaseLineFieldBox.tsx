import type { ReactNode } from "react";

import { cn } from "@/shared/utils/cn";

import {
  purchaseLineFieldBoxClassName,
  purchaseLineFieldBoxLockedClassName,
  purchaseLineFieldLabelClassName,
} from "../utils/purchaseCreateStyles";

type PurchaseLineFieldBoxProps = {
  align?: "left" | "center" | "right";
  children: ReactNode;
  headerAction?: ReactNode;
  label: string;
  /** Valor calculado o no editable: borde punteado. */
  locked?: boolean;
};

/** Caja etiqueta + control de la fila secundaria de una línea de compra. */
export function PurchaseLineFieldBox({
  align = "left",
  children,
  headerAction,
  label,
  locked = false,
}: PurchaseLineFieldBoxProps) {
  return (
    <div
      className={cn(
        "relative min-w-0",
        locked ? purchaseLineFieldBoxLockedClassName : purchaseLineFieldBoxClassName,
      )}
    >
      {headerAction ? (
        <div className="absolute -top-2 -right-2 z-10">{headerAction}</div>
      ) : null}
      <span
        className={cn(
          purchaseLineFieldLabelClassName,
          align === "center" && "text-center",
          align === "right" && "text-right",
        )}
      >
        {label}
      </span>
      {children}
    </div>
  );
}
