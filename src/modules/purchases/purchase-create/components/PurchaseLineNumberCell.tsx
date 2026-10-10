"use client";

import { type KeyboardEvent, type Ref, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { NumberInput } from "@/shared/components/NumberInput";
import { useToast } from "@/shared/components/Toast";
import { cn } from "@/shared/utils/cn";
import { roundMoney } from "@/shared/utils/currency";

import {
  type PurchaseLineScan,
  readScanDigits,
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
  /**
   * Cómo nombra a esta celda el aviso «Revisa … : se escaneó un código mientras lo
   * editabas» («el costo de Taladro»). Sin él, su `aria-label` entre comillas.
   */
  scanNoticeSubject?: string;
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
 * Dígitos que `NumberInput` deja escribir; los siguientes los descarta. Una cantidad de 3
 * cifras y un EAN-13 son 16: la celda guarda los que no caben para que el código llegue entero.
 */
const FIELD_MAX_DIGITS = 15;

function countDigits(text: string) {
  return text.replace(/\D/g, "").length;
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
 *   siguiente escaneo se teclea aquí. Un texto de `PURCHASE_SCAN_MIN_DIGITS` o más
 *   dígitos seguidos no es una cantidad ni un costo: el padre vuelve al valor que
 *   tenía la celda, y con Enter sale por `onScan`.
 * - El texto es «valor opcional + código». Dónde empieza el código no lo decide solo
 *   el tiempo entre teclas (un atasco de la página parte la ráfaga del lector): la
 *   celda propone los sufijos posibles y `onScan` contesta cuál existe. Lo que queda
 *   delante de ese código es el valor tecleado, con su separador decimal y sus
 *   decimales («55.5» + código = 55.5; «12.» + código = 12); si no hay o no vale, se
 *   conserva el que tenía la celda. Si ninguno existe queda lo tecleado a mano antes de
 *   la ráfaga o, si no hay, el valor que tenía.
 * - Un valor tecleado nunca se pierde callando: si el código no existe y el tiempo entre
 *   teclas no dice dónde acababan los decimales, o lo que queda delante del código no
 *   vale para la celda (un decimal en una cantidad), avisa con «Revisa … : se escaneó un
 *   código mientras lo editabas» y la celda queda resaltada (`data-review`) hasta que se
 *   vuelve a entrar en ella.
 * - El escaneo se encola y el foco pasa al buscador (D36); mientras se resuelve, la
 *   celda muestra ese valor. Otro escaneo aquí antes de la respuesta también se encola.
 * - En una celda entera, un valor de más de 6 dígitos no sube mientras se escribe
 *   (podría ser un código a medio llegar): sube al salir o con Enter.
 * - El campo no admite más de `FIELD_MAX_DIGITS` dígitos: los que el lector teclea de
 *   más no se ven, pero cuentan al leer el escaneo (cantidad de varias cifras + código).
 */
export function PurchaseLineNumberCell({
  className,
  focusTarget = false,
  integer = false,
  onChange,
  onScan,
  scanNoticeSubject,
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
  // Un escaneo dejó en duda el valor de la celda: resaltada hasta que se vuelva a entrar en ella.
  const [needsReview, setNeedsReview] = useState(false);
  const { showToast } = useToast();
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
  // Dígitos tecleados al final que el campo descartó por estar lleno (`FIELD_MAX_DIGITS`).
  const overflow = useRef("");
  // El foco está saliendo con un código escrito en el campo (no con un valor).
  const leavingWithScan = useRef(false);
  // Valor válido que aún no subió al padre por tener demasiados dígitos.
  const held = useRef<number | null>(null);
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

  function askReview() {
    setNeedsReview(true);
    showToast({
      title: `Revisa ${scanNoticeSubject ?? `«${props["aria-label"]}»`}: se escaneó un código mientras lo editabas.`,
      tone: "error",
    });
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
    // `NumberInput` redondea lo escrito al salir: si era un código detrás de los decimales
    // de un costo, ese redondeo no es un valor que alguien haya tecleado.
    if (leavingWithScan.current) {
      return;
    }

    held.current = null;

    if (readScanDigits(text.current) !== null) {
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
    leavingWithScan.current = false;
    overflow.current = "";
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
      const fieldDigits = countDigits(field.value);
      const writtenDigits = fieldDigits + overflow.current.length;
      // Un instante por DÍGITO: el separador decimal no lleva (un lector no lo teclea).
      const known =
        stamps.current.length === writtenDigits
          ? stamps.current
          : Array.from({ length: writtenDigits }, () => -Infinity);

      // Campo lleno y sin selección que sustituir: `NumberInput` va a descartar la tecla.
      if (start === end && fieldDigits >= FIELD_MAX_DIGITS) {
        if (start === field.value.length) {
          overflow.current += event.key;
          stamps.current = [...known, Date.now()];
        }

        return;
      }

      overflow.current = "";
      stamps.current = [
        ...known.slice(0, countDigits(field.value.slice(0, start))),
        Date.now(),
        ...known.slice(countDigits(field.value.slice(0, end)), fieldDigits),
      ];
      return;
    }

    const scanText = field.value + overflow.current;

    overflow.current = "";

    const scan =
      event.key === "Enter" ? readPurchaseLineScan(scanText, stamps.current, Date.now()) : null;

    if (scan) {
      const before = committed.current;
      const typedValue = isValidValue(scan.typedValue, integer) ? scan.typedValue : null;

      // Sin esto NumberInput normalizaría el código como si fuera el valor de la celda.
      event.preventDefault();
      held.current = null;
      // `onScan` se lleva el foco al buscador (D36): el campo ya debe mostrar su valor, o
      // al salir se normalizaría el código como si fuera lo escrito.
      flushSync(() => {
        setTyped(null);
        send(typedValue ?? before);
      });

      const settle = (code: string | null) => {
        if (code === null) {
          // Ningún candidato existe: queda lo tecleado a mano según el tiempo entre teclas.
          if (scan.typedUnclear) {
            askReview();
          }

          return;
        }

        const typedText = scanText.slice(0, scanText.length - code.length);
        const valueBeforeCode = readValueBeforeCode(scanText, code);

        if (isValidValue(valueBeforeCode, integer)) {
          send(valueBeforeCode);
          return;
        }

        send(before);

        // Un decimal delante del código que no vale para esta celda: no se descarta callando.
        if (typedText.includes(".")) {
          askReview();
        }
      };

      if (onScan) {
        onScan({ candidates: scan.candidates, onResolved: settle });
      } else {
        settle(null);
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
        (flashing || needsReview) && "border-primary bg-primary/10",
      )}
      data-flash={flashing ? "true" : undefined}
      data-review={needsReview ? "true" : undefined}
      data-line-focus={focusTarget ? "true" : undefined}
      decimals={integer ? 0 : 2}
      min={integer ? 1 : 0}
      onBlur={handleBlur}
      // Antes de que `NumberInput` normalice lo escrito al salir.
      onBlurCapture={() => {
        leavingWithScan.current = readScanDigits(text.current) !== null;
      }}
      onChange={(event) => {
        text.current = event.currentTarget.value;
      }}
      onFocus={() => {
        committed.current = value;
        setNeedsReview(false);
      }}
      onKeyDown={handleKeyDown}
      onValueChange={handleValueChange}
      // Un costo se ve siempre con dos decimales: «30.600» queda en 30.60, no en 30.6 (D26).
      padDecimals={!integer}
      // En el flujo, el aviso de miles sube la fila de 71 a 113 px y empuja las siguientes (AUD-02).
      thousandsHintPlacement="floating"
      value={shown}
    />
  );
}
