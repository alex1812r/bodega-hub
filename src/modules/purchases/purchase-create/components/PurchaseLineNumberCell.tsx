"use client";

import { type KeyboardEvent, type Ref, useEffect, useRef, useState } from "react";

import { NumberInput } from "@/shared/components/NumberInput";
import { cn } from "@/shared/utils/cn";
import { roundMoney } from "@/shared/utils/currency";

import {
  type PurchaseLineScan,
  isScannedCode,
  readPurchaseLineScan,
  readValueBeforeCode,
} from "../utils/purchaseLineScan";

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
   * Enter con `PURCHASE_SCAN_MIN_DIGITS` o más dígitos seguidos es un lector que escribió
   * aquí: recibe los códigos posibles y avisa de cuál existía (`PurchaseLineScan`).
   */
  onScan?: (scan: PurchaseLineScan) => void;
  ref?: Ref<HTMLInputElement>;
  value: number;
};

function isValidValue(value: number | null, integer: boolean): value is number {
  if (value === null) {
    return false;
  }

  return integer ? Number.isInteger(value) && value >= 1 : value >= 0 && roundMoney(value) === value;
}

/** Con más dígitos el valor no sube mientras se escribe: puede ser un código a medio llegar. */
const LIVE_MAX_DIGITS = 6;

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
 *   siguiente escaneo se teclea aquí. Un texto de `PURCHASE_SCAN_MIN_DIGITS` o más
 *   dígitos seguidos no es una cantidad ni un costo: el padre vuelve al valor que
 *   tenía la celda, y con Enter sale por `onScan`.
 * - El texto es «valor opcional + código». Dónde empieza el código no lo decide solo
 *   el tiempo entre teclas (un atasco de la página parte la ráfaga del lector): la
 *   celda propone los sufijos posibles y `onScan` contesta cuál existe. Lo que queda
 *   delante de ese código es el valor tecleado; si no hay o no vale, se conserva el
 *   que tenía la celda. Si ninguno existe queda lo tecleado a mano antes de la
 *   ráfaga o, si no hay, el valor que tenía.
 * - Mientras se resuelve, la celda muestra ese valor y otro Enter no hace nada.
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
  // Hay un escaneo de esta celda resolviéndose: otro Enter no lanza un segundo.
  const scanning = useRef(false);
  // `onChange` del último render: un escaneo se resuelve después del Enter.
  const onChangeRef = useRef(onChange);
  const shown = typed && typed.parent === value ? typed.value : value;

  useEffect(() => {
    latest.current = value;
  }, [value]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

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
      onChangeRef.current(next);
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

    if (isScannedCode(text.current)) {
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

    if (/^\d$/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const start = field.selectionStart ?? field.value.length;
      const end = field.selectionEnd ?? start;
      const known =
        stamps.current.length === field.value.length
          ? stamps.current
          : field.value.split("").map(() => -Infinity);

      stamps.current = [...known.slice(0, start), Date.now(), ...known.slice(end)];
      return;
    }

    if (event.key === "Enter" && scanning.current) {
      event.preventDefault();
      return;
    }

    const scanText = field.value;
    const scan =
      event.key === "Enter" ? readPurchaseLineScan(scanText, stamps.current, Date.now()) : null;

    if (scan) {
      const before = committed.current;

      // Sin esto NumberInput normalizaría el código como si fuera el valor de la celda.
      event.preventDefault();
      held.current = null;
      setTyped(null);
      send(scan.typedValue ?? before);

      if (onScan) {
        scanning.current = true;
        onScan({
          candidates: scan.candidates,
          onResolved: (code) => {
            scanning.current = false;

            if (code !== null) {
              send(readValueBeforeCode(scanText, code) ?? before);
            }
          },
        });
      }

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
