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
  /**
   * Solo en celdas enteras: Enter tras un código de `PURCHASE_SCAN_MIN_DIGITS` o más
   * dígitos es un lector que escribió aquí; recibe el código tal cual lo tecleó el lector,
   * sin la cantidad que el usuario hubiera escrito antes.
   */
  onScan?: (code: string) => void;
  ref?: Ref<HTMLInputElement>;
  value: number;
};

/**
 * Longitud mínima de un código de barras (EAN-8). Ninguna cantidad real llega a
 * ocho dígitos: en una celda entera, un texto así es un escaneo y nunca sube.
 */
export const PURCHASE_SCAN_MIN_DIGITS = 8;

function isScannedCode(text: string) {
  return /^\d+$/.test(text) && text.length >= PURCHASE_SCAN_MIN_DIGITS;
}

function isValidValue(value: number | null, integer: boolean): value is number {
  if (value === null) {
    return false;
  }

  return integer ? Number.isInteger(value) && value >= 1 : value >= 0 && roundMoney(value) === value;
}

/**
 * Un lector deja pocos milisegundos entre dos teclas; quien teclea a mano, bastante más.
 * Por debajo de este intervalo dos teclas seguidas son de la misma ráfaga.
 */
export const PURCHASE_SCAN_KEY_GAP_MS = 50;

/** Con más dígitos el valor no sube mientras se escribe: puede ser un código a medio llegar. */
const LIVE_MAX_DIGITS = 6;

/**
 * Cuántos caracteres del final de `text` llegaron en ráfaga hasta `now` (el Enter).
 * `stamps` trae el instante de cada carácter; si no casa con el texto no hay tiempos
 * de los que fiarse y la ráfaga es 0.
 */
function countBurst(text: string, stamps: number[], now: number) {
  if (stamps.length !== text.length) {
    return 0;
  }

  let count = 0;
  let next = now;

  while (count < text.length && next - stamps[text.length - 1 - count] < PURCHASE_SCAN_KEY_GAP_MS) {
    next = stamps[text.length - 1 - count];
    count += 1;
  }

  return count;
}

/**
 * Lo que un Enter encuentra en una celda entera. Si el final del texto llegó en ráfaga y
 * mide como un código, ese es el código y lo de antes es la cantidad que tecleó el usuario
 * (`null` si no hay o no vale: se conserva la anterior). Sin tiempos que separen, el texto
 * entero es el código. `null` = no hay escaneo.
 */
function readScan(text: string, stamps: number[], now: number) {
  const burst = countBurst(text, stamps, now);
  const code = text.slice(text.length - burst);

  if (burst < text.length && isScannedCode(code)) {
    const before = text.slice(0, text.length - burst);
    const quantity = /^\d+$/.test(before) && !isScannedCode(before) ? Number(before) : null;

    return { code, quantity: isValidValue(quantity, true) ? quantity : null };
  }

  return isScannedCode(text) ? { code: text, quantity: null } : null;
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
 * - Lector USB (COM-12): la línea recién agregada deja el foco en Cantidad y el
 *   siguiente escaneo se teclea aquí. En una celda entera, un texto de
 *   `PURCHASE_SCAN_MIN_DIGITS` o más dígitos no es una cantidad: el padre vuelve
 *   al valor que tenía la celda, y con Enter el código sale por `onScan`.
 * - El código es la ráfaga final (teclas a menos de `PURCHASE_SCAN_KEY_GAP_MS`
 *   entre sí y del Enter): lo tecleado antes es la cantidad y se confirma. Si todo
 *   llegó igual de rápido, o pegado, el código es el texto entero.
 * - En una celda entera, un valor de más de 6 dígitos no sube mientras se escribe
 *   (podría ser un código a medio llegar): sube al salir o con Enter.
 */
export function PurchaseLineNumberCell({
  className,
  focusTarget = false,
  integer = false,
  onChange,
  onScan,
  value,
  ...props
}: PurchaseLineNumberCellProps) {
  // Lo que hay escrito cuando no coincide con el padre (vacío, a medio teclear).
  // Solo vale mientras el padre siga en `parent`: si cambia por fuera, manda el padre.
  const [typed, setTyped] = useState<{
    parent: number;
    value: number | string | null;
  } | null>(null);
  const [flashing, setFlashing] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Último valor que tiene el padre, también dentro del mismo evento (blur normaliza y sale).
  const latest = useRef(value);
  // Valor de la celda al entrar o tras el último cambio confirmado.
  const committed = useRef(value);
  // Valor anterior al último cambio confirmado; `null` = nada que deshacer.
  const undo = useRef<number | null>(null);
  // Texto del campo tal cual: un código leído conserva sus ceros a la izquierda.
  const text = useRef("");
  // Instante en que se tecleó cada carácter del campo (`-Infinity` = ya estaba).
  const stamps = useRef<number[]>([]);
  // Valor válido que aún no subió al padre por tener demasiados dígitos.
  const held = useRef<number | null>(null);
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

  function sendHeld() {
    if (held.current !== null) {
      send(held.current);
      held.current = null;
    }
  }

  function handleValueChange(next: number | null) {
    held.current = null;

    if (integer && isScannedCode(text.current)) {
      setTyped({ parent: committed.current, value: text.current });
      send(committed.current);
      return;
    }

    if (integer && isValidValue(next, true) && text.current.length > LIVE_MAX_DIGITS) {
      held.current = next;
      setTyped({ parent: latest.current, value: text.current });
      return;
    }

    if (isValidValue(next, integer)) {
      setTyped({ parent: next, value: next });
      send(next);
      return;
    }

    setTyped({ parent: latest.current, value: next });
  }

  function handleBlur() {
    sendHeld();
    setTyped(null);

    if (latest.current !== committed.current) {
      undo.current = committed.current;
      committed.current = latest.current;
      flash();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const field = event.currentTarget;

    if (integer && /^\d$/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const start = field.selectionStart ?? field.value.length;
      const end = field.selectionEnd ?? start;
      const known =
        stamps.current.length === field.value.length
          ? stamps.current
          : field.value.split("").map(() => -Infinity);

      stamps.current = [...known.slice(0, start), Date.now(), ...known.slice(end)];
      return;
    }

    const scan =
      event.key === "Enter" && integer ? readScan(field.value, stamps.current, Date.now()) : null;

    if (scan) {
      // Sin esto NumberInput normalizaría el código como si fuera la cantidad.
      event.preventDefault();
      held.current = null;
      setTyped(null);
      send(scan.quantity ?? committed.current);
      onScan?.(scan.code);
      return;
    }

    if (event.key === "Enter") {
      sendHeld();
      return;
    }

    if (event.key !== "Escape") {
      return;
    }

    held.current = null;

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
      onChange={(event) => {
        text.current = event.currentTarget.value;
      }}
      onFocus={() => {
        committed.current = value;
      }}
      onKeyDown={handleKeyDown}
      onValueChange={handleValueChange}
      value={shown}
    />
  );
}
