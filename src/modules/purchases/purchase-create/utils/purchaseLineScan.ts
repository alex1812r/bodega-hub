/**
 * Longitud mínima de un código de barras (EAN-8). Ninguna cantidad ni costo unitario
 * real llega a ocho dígitos enteros: en una celda de línea, un texto así es un escaneo.
 */
export const PURCHASE_SCAN_MIN_DIGITS = 8;

/**
 * Un lector deja pocos milisegundos entre dos teclas; quien teclea a mano, bastante más.
 * Por debajo de este intervalo dos teclas seguidas son de la misma ráfaga.
 */
export const PURCHASE_SCAN_KEY_GAP_MS = 50;

/** Códigos que se consultan como mucho por escaneo, uno tras otro. */
export const PURCHASE_SCAN_MAX_CANDIDATES = 4;

/** EAN-13, UPC-A, ITF-14 y EAN-8: los largos que se prueban, en este orden. */
const TYPICAL_CODE_LENGTHS = [13, 12, 14, 8];

/** Lo tecleado delante de un código solo vale como cantidad o costo hasta este largo. */
const TYPED_VALUE_MAX_DIGITS = 6;

/**
 * Un escaneo que cayó en una celda de línea. El reloj de la página no basta para saber
 * dónde empieza el código (si la página se atasca, la ráfaga del lector llega partida),
 * así que la celda da los códigos posibles y quien los resuelve dice cuál existía.
 */
export type PurchaseLineScan = {
  /** Códigos a consultar en este orden; el primero que exista es el escaneado. */
  candidates: string[];
  /**
   * Se llama una vez, ANTES de agregar el producto (agregar puede bloquear la línea):
   * el candidato que existía, o `null` si ninguno.
   */
  onResolved: (code: string | null) => void;
};

/** Lo que un Enter encuentra en una celda cuyo texto mide como un escaneo. */
export type PurchaseLineScanReading = {
  candidates: string[];
  /** Lo tecleado a mano antes del escaneo, o `null` si no hay o no vale. */
  typedValue: number | null;
};

export function isScannedCode(text: string) {
  return /^\d+$/.test(text) && text.length >= PURCHASE_SCAN_MIN_DIGITS;
}

function readTypedValue(text: string) {
  if (!/^\d+$/.test(text) || text.length > TYPED_VALUE_MAX_DIGITS) {
    return null;
  }

  const value = Number(text);

  return value > 0 ? value : null;
}

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
 * El código según el tiempo entre teclas: la ráfaga final si mide como un código y hay
 * algo delante; si no (todo igual de rápido, pegado, a mano o un tramo final corto), el
 * texto entero.
 */
function readTimedCode(text: string, stamps: number[], now: number) {
  const burst = countBurst(text, stamps, now);
  const code = text.slice(text.length - burst);

  return burst < text.length && isScannedCode(code) ? code : text;
}

/**
 * Lo que se tecleó a mano al principio de `text`: los caracteres seguidos de una pausa.
 * Termina en la primera tecla a la que otra sigue a ritmo de ráfaga: desde ahí puede ser
 * el lector, aunque un atasco haya partido su ráfaga en tramos.
 */
function readHandTypedPrefix(text: string, stamps: number[], now: number) {
  if (stamps.length !== text.length) {
    return "";
  }

  let count = 0;

  while (
    count < text.length &&
    !((stamps[count + 1] ?? now) - stamps[count] < PURCHASE_SCAN_KEY_GAP_MS)
  ) {
    count += 1;
  }

  return text.slice(0, count);
}

/**
 * Enter en una celda de línea. `null` = el texto no es un escaneo (menos de
 * `PURCHASE_SCAN_MIN_DIGITS` dígitos, o no son solo dígitos).
 *
 * El texto es «valor opcional + código», y el código es un SUFIJO. Candidatos, sin
 * repetir y hasta `PURCHASE_SCAN_MAX_CANDIDATES`: los sufijos de 13, 12, 14 y 8 dígitos,
 * en ese orden. Si el texto es tan corto que no dan cuatro, cierra la lista el corte que
 * sugiere el tiempo entre teclas (un código de otro largo, p. ej. 10 dígitos). Ningún
 * otro sufijo se consulta: un código inexistente no puede costar una docena de peticiones.
 */
export function readPurchaseLineScan(
  text: string,
  stamps: number[],
  now: number,
): PurchaseLineScanReading | null {
  if (!isScannedCode(text)) {
    return null;
  }

  const suffixes = TYPICAL_CODE_LENGTHS.filter((length) => length <= text.length).map((length) =>
    text.slice(text.length - length),
  );

  return {
    candidates: [...new Set([...suffixes, readTimedCode(text, stamps, now)])].slice(
      0,
      PURCHASE_SCAN_MAX_CANDIDATES,
    ),
    typedValue: readTypedValue(readHandTypedPrefix(text, stamps, now)),
  };
}

/**
 * El valor de la celda cuando `code` (un sufijo de `text`) resultó ser el código: lo que
 * queda delante, si es un entero mayor que 0 de hasta 6 dígitos. `null` = no se tecleó
 * ninguno que valga y la celda conserva el que tenía.
 */
export function readValueBeforeCode(text: string, code: string) {
  return readTypedValue(text.slice(0, text.length - code.length));
}
