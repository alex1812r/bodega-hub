"use client";

import { useEffect, useRef } from "react";

/**
 * Tiempo máximo entre dos teclas de una misma lectura, y entre la última y su Enter.
 * Cubre lectores lentos o inalámbricos (hasta ~300 ms por tecla, con margen).
 */
export const SCANNER_BURST_KEY_GAP_MS = 400;

/** Caracteres seguidos a partir de los cuales un Enter inmediato es de un lector. */
export const SCANNER_BURST_MIN_KEYS = 3;

/** Un Enter tan pegado a una tecla de carácter no es de una persona, sea cual sea el largo. */
export const SCANNER_FAST_KEY_GAP_MS = 50;

/**
 * Enfriamiento tras ignorar el Enter de un lector: lo que quede de su sufijo (CR+LF,
 * Enter repetido, Tab) llega pegado, y una persona no pulsa nada tan pronto.
 */
export const SCANNER_SUFFIX_COOLDOWN_MS = 450;

/** Teclas de sufijo de un lector que pulsarían un botón o moverían el foco. */
const SUFFIX_KEYS = new Set(["Enter", "Tab", " "]);

/** Caracteres que se conservan de una ráfaga: de sobra para el código más largo. */
const MAX_BUFFERED_KEYS = 64;

/** Tiempos de la ráfaga que cerró un Enter de lector. */
export type ScannerBurst = {
  /** Instante (`Date.now()`) del Enter. */
  enteredAt: number;
  /** Instante de cada carácter del texto, en el mismo orden. */
  keyTimes: number[];
};

export type ScannerInputHandler = (text: string, burst: ScannerBurst) => void;

const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/** El foco está donde se escribe: ahí teclear y Enter son del campo, no de un lector perdido. */
function isTextEntry(target: EventTarget | null) {
  if (target instanceof HTMLTextAreaElement) {
    return true;
  }

  if (target instanceof HTMLInputElement) {
    return !NON_TEXT_INPUT_TYPES.has(target.type);
  }

  return target instanceof HTMLElement && target.isContentEditable === true;
}

function swallow(event: KeyboardEvent) {
  // En captura y antes que nadie: ni el botón enfocado ni el diálogo ven esta tecla.
  event.preventDefault();
  event.stopPropagation();
}

/**
 * Lector de códigos con una confirmación abierta. La lectura llega como teclas sobre lo
 * que tenga el foco, y su Enter pulsaría ese botón. Mientras `active`:
 *
 * - Una ráfaga son teclas de carácter (cualquiera imprimible) seguidas, cada una a menos
 *   de `SCANNER_BURST_KEY_GAP_MS` de la anterior. Ctrl, Alt y Meta no cuentan.
 * - El Enter que la cierra se ignora (no llega a ningún botón) si llega a menos de
 *   `SCANNER_BURST_KEY_GAP_MS` del último carácter de una ráfaga de
 *   `SCANNER_BURST_MIN_KEYS` o más, o a menos de `SCANNER_FAST_KEY_GAP_MS` de
 *   cualquier carácter. `onScannerInput` recibe entonces lo leído.
 * - Un espacio dentro de una ráfaga tampoco pulsa el botón enfocado.
 * - Tras un Enter ignorado, cualquier Enter (también el del teclado numérico), Tab o
 *   Espacio que llegue a menos de `SCANNER_SUFFIX_COOLDOWN_MS` del último ignorado
 *   también se ignora: es el resto del sufijo del lector (CR+LF, Enter×3, Enter+Tab+Enter).
 *   Cada uno renueva el plazo, así que un lector lento no se cuela. Un Tab que no sigue a
 *   un Enter ignorado no se toca: solo mueve el foco, y el Enter que lo siga cierra la
 *   ráfaga igual.
 * - Con el foco en un campo de texto no se toca nada: se teclea y se confirma como siempre.
 *
 * Un Enter o un Espacio sin ráfaga delante (una persona) no se tocan.
 */
export function useScannerBurstGuard(active: boolean, onScannerInput?: ScannerInputHandler) {
  const onScannerInputRef = useRef(onScannerInput);

  useEffect(() => {
    onScannerInputRef.current = onScannerInput;
  });

  useEffect(() => {
    if (!active) {
      return;
    }

    let text = "";
    let keyTimes: number[] = [];
    // Hasta cuándo se ignora el resto del sufijo del lector (0 = ningún Enter ignorado).
    let cooldownUntil = 0;
    // Teclas ignoradas al pulsarse: al soltarse tampoco llegan (Espacio pulsa al soltar).
    const swallowedKeyUps = new Set<string>();

    function swallowKey(event: KeyboardEvent) {
      swallow(event);
      swallowedKeyUps.add(event.key);
    }

    function clear() {
      text = "";
      keyTimes = [];
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      if (isTextEntry(event.target)) {
        clear();
        return;
      }

      const now = Date.now();
      const sinceLastKey = keyTimes.length > 0 ? now - keyTimes[keyTimes.length - 1] : Infinity;

      if (now < cooldownUntil && SUFFIX_KEYS.has(event.key)) {
        cooldownUntil = now + SCANNER_SUFFIX_COOLDOWN_MS;
        clear();
        swallowKey(event);
        return;
      }

      if (event.key.length === 1) {
        const continues = sinceLastKey < SCANNER_BURST_KEY_GAP_MS;

        // Un espacio suelto, o repetido, es de una persona; detrás de otro carácter, del lector.
        if (event.key === " " && continues && text.trim() !== "") {
          swallowKey(event);
        }

        text = ((continues ? text : "") + event.key).slice(-MAX_BUFFERED_KEYS);
        keyTimes = [...(continues ? keyTimes : []), now].slice(-MAX_BUFFERED_KEYS);
        return;
      }

      if (event.key !== "Enter") {
        return;
      }

      const burstText = text;
      const burst: ScannerBurst = { enteredAt: now, keyTimes };

      clear();

      const closesBurst =
        burstText.length >= SCANNER_BURST_MIN_KEYS && sinceLastKey < SCANNER_BURST_KEY_GAP_MS;

      if (!closesBurst && !(sinceLastKey < SCANNER_FAST_KEY_GAP_MS)) {
        return;
      }

      cooldownUntil = now + SCANNER_SUFFIX_COOLDOWN_MS;
      swallowKey(event);
      onScannerInputRef.current?.(burstText, burst);
    }

    // Un botón se pulsa con Espacio al soltar la tecla: la de una tecla ignorada tampoco llega.
    function handleKeyUp(event: KeyboardEvent) {
      if (swallowedKeyUps.delete(event.key)) {
        swallow(event);
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("keyup", handleKeyUp, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("keyup", handleKeyUp, true);
    };
  }, [active]);
}
