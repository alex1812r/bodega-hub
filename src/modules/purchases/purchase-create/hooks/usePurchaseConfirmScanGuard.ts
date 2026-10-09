"use client";

import { useEffect, useRef } from "react";

import { PURCHASE_SCAN_KEY_GAP_MS, readPurchaseLineScan } from "../utils/purchaseLineScan";

/**
 * Un lector lento (o inalámbrico) puede dejar más de `PURCHASE_SCAN_KEY_GAP_MS` entre dos
 * teclas, pero no tanto: los dígitos separados por más de esto ya no son del mismo código.
 */
export const PURCHASE_CONFIRM_SCAN_SLOW_GAP_MS = 250;

/** Dígitos que se conservan: de sobra para el código más largo con algo tecleado delante. */
const MAX_BUFFERED_DIGITS = 32;

/**
 * Lector de códigos con la confirmación de compra abierta (CNF-F5). El modal no tiene
 * dónde escribir, así que la ráfaga del lector cae sobre el botón enfocado y su Enter lo
 * pulsaría. Mientras `active`, el Enter que cierra una ráfaga se intercepta antes de que
 * llegue a ningún botón:
 * - llega a menos de `PURCHASE_SCAN_KEY_GAP_MS` de otra tecla de carácter (nadie teclea así), o
 * - cierra 8 o más dígitos seguidos, aunque el lector sea lento.
 *
 * `onScan` recibe los códigos posibles (los mismos candidatos que una celda de línea) o
 * `null` si la ráfaga no medía como un código. Un Enter suelto no se toca.
 */
export function usePurchaseConfirmScanGuard(
  active: boolean,
  onScan: ((candidates: string[] | null) => void) | undefined,
) {
  const onScanRef = useRef(onScan);

  useEffect(() => {
    onScanRef.current = onScan;
  });

  useEffect(() => {
    if (!active) {
      return;
    }

    let digits = "";
    let stamps: number[] = [];
    let lastKeyAt = -Infinity;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      const now = Date.now();
      const sinceLastKey = now - lastKeyAt;

      if (event.key.length === 1) {
        const isDigit = /^\d$/.test(event.key);
        const keeps = isDigit && sinceLastKey < PURCHASE_CONFIRM_SCAN_SLOW_GAP_MS;

        digits = ((keeps ? digits : "") + (isDigit ? event.key : "")).slice(-MAX_BUFFERED_DIGITS);
        stamps = [...(keeps ? stamps : []), ...(isDigit ? [now] : [])].slice(-MAX_BUFFERED_DIGITS);
        lastKeyAt = now;
        return;
      }

      if (event.key !== "Enter") {
        return;
      }

      const reading =
        sinceLastKey < PURCHASE_CONFIRM_SCAN_SLOW_GAP_MS
          ? readPurchaseLineScan(digits, stamps, now)
          : null;

      digits = "";
      stamps = [];

      if (!reading && !(sinceLastKey < PURCHASE_SCAN_KEY_GAP_MS)) {
        return;
      }

      // En captura y antes que nadie: ni el botón enfocado ni el diálogo ven este Enter.
      event.preventDefault();
      event.stopPropagation();
      onScanRef.current?.(reading ? reading.candidates : null);
    }

    document.addEventListener("keydown", handleKeyDown, true);

    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [active]);
}
