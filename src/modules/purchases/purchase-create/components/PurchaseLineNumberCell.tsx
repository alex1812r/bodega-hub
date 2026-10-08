"use client";

import { type KeyboardEvent, type Ref, useEffect, useRef, useState } from "react";

import { NumberInput } from "@/shared/components/NumberInput";
import { cn } from "@/shared/utils/cn";
import { roundMoney } from "@/shared/utils/currency";

/** Tiempo que una celda queda resaltada tras cambiar su valor. */
export const PURCHASE_CELL_FLASH_MS = 1500;

type PurchaseLineNumberCellProps = {
  "aria-label": string;
  className?: string;
  /** Campo que toma el foco cuando la línea lo pide (`data-line-focus`): la cantidad. */
  focusTarget?: boolean;
  /** Cantidades y empaques: entero, mínimo 1. Sin él es un costo: mínimo 0, dos decimales. */
  integer?: boolean;
  /** Solo recibe valores válidos; lo vacío o a medio escribir se queda en la celda. */
  onChange: (value: number) => void;
  ref?: Ref<HTMLInputElement>;
  value: number;
};

function isValidValue(value: number | null, integer: boolean): value is number {
  if (value === null) {
    return false;
  }

  return integer ? Number.isInteger(value) && value >= 1 : value >= 0 && roundMoney(value) === value;
}

/**
 * Celda numérica de una línea de compra (COM-13), sobre `NumberInput`.
 *
 * - Mientras se escribe, cada valor válido sube al padre (los totales se mueven
 *   en vivo); un campo vacío o un decimal en una cantidad no suben, y al salir
 *   la celda vuelve al último valor válido.
 * - El cambio se CONFIRMA al salir de la celda: si el valor es distinto del que
 *   tenía al entrar, la celda se resalta `PURCHASE_CELL_FLASH_MS`.
 * - `Esc` deshace el último cambio de esta celda: a medio escribir vuelve al
 *   valor que tenía al entrar; si no hay nada a medias, al valor anterior al
 *   último cambio confirmado (un nivel). Sin nada que deshacer no hace nada y
 *   deja pasar la tecla.
 */
export function PurchaseLineNumberCell({
  className,
  focusTarget = false,
  integer = false,
  onChange,
  value,
  ...props
}: PurchaseLineNumberCellProps) {
  // Lo que hay escrito cuando no coincide con el padre (vacío, a medio teclear).
  // Solo vale mientras el padre siga en `parent`: si cambia por fuera, manda el padre.
  const [typed, setTyped] = useState<{ parent: number; value: number | null } | null>(null);
  const [flashing, setFlashing] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Último valor que tiene el padre, también dentro del mismo evento (blur normaliza y sale).
  const latest = useRef(value);
  // Valor de la celda al entrar o tras el último cambio confirmado.
  const committed = useRef(value);
  // Valor anterior al último cambio confirmado; `null` = nada que deshacer.
  const undo = useRef<number | null>(null);
  const shown = typed && typed.parent === value ? typed.value : value;

  useEffect(() => {
    latest.current = value;
  }, [value]);

  useEffect(
    () => () => {
      if (flashTimer.current) {
        clearTimeout(flashTimer.current);
      }
    },
    [],
  );

  function flash() {
    if (flashTimer.current) {
      clearTimeout(flashTimer.current);
    }

    setFlashing(true);
    flashTimer.current = setTimeout(() => setFlashing(false), PURCHASE_CELL_FLASH_MS);
  }

  function send(next: number) {
    if (next !== latest.current) {
      latest.current = next;
      onChange(next);
    }
  }

  function handleValueChange(next: number | null) {
    if (isValidValue(next, integer)) {
      setTyped({ parent: next, value: next });
      send(next);
      return;
    }

    setTyped({ parent: latest.current, value: next });
  }

  function handleBlur() {
    setTyped(null);

    if (latest.current !== committed.current) {
      undo.current = committed.current;
      committed.current = latest.current;
      flash();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Escape") {
      return;
    }

    if (shown !== committed.current) {
      setTyped(null);
      send(committed.current);
    } else if (undo.current !== null) {
      committed.current = undo.current;
      undo.current = null;
      setTyped(null);
      send(committed.current);
      flash();
    } else {
      return;
    }

    // La tecla ya hizo algo aquí: que no cierre además lo que envuelva a la tabla.
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <NumberInput
      {...props}
      className={cn(
        className,
        "motion-reduce:transition-none",
        flashing && "border-primary bg-primary/10",
      )}
      data-flash={flashing ? "true" : undefined}
      data-line-focus={focusTarget ? "true" : undefined}
      decimals={integer ? 0 : 2}
      min={integer ? 1 : 0}
      onBlur={handleBlur}
      onFocus={() => {
        committed.current = value;
      }}
      onKeyDown={handleKeyDown}
      onValueChange={handleValueChange}
      value={shown}
    />
  );
}
