import { roundMoney } from "@/shared/utils/currency";

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

/**
 * Códigos que se consultan como mucho por escaneo, uno tras otro. Cada uno son dos
 * peticiones (por código de barras y por SKU): un código inexistente cuesta 4 como mucho.
 */
export const PURCHASE_SCAN_MAX_CANDIDATES = 2;

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
  /**
   * Lo tecleado a mano antes del escaneo según el tiempo entre teclas, con su separador
   * decimal y sus decimales; `null` si no hay o no vale.
   */
  typedValue: number | null;
  /**
   * Hay un valor con decimales delante del código y el tiempo entre teclas no dice dónde
   * termina: si ningún candidato existe, `typedValue` es solo su parte segura y hay que avisar.
   */
  typedUnclear: boolean;
};

export function isScannedCode(text: string) {
  return /^\d+$/.test(text) && text.length >= PURCHASE_SCAN_MIN_DIGITS;
}

/**
 * Parte el texto de una celda en lo que va hasta el separador decimal (con él) y la zona
 * donde puede estar un código. Un lector no teclea separadores: si hay uno, el código solo
 * puede ir detrás. `null` = el texto no es «dígitos» ni «dígitos.dígitos».
 */
function splitScanText(text: string) {
  const match = /^(\d*\.)?(\d*)$/.exec(text);

  return match ? { head: match[1] ?? "", zone: match[2] } : null;
}

/**
 * Los dígitos de `text` entre los que está un código leído, o `null` si el texto es un
 * valor normal. Además del texto entero de 8 o más dígitos, cuenta el de un costo con
 * 8 o más decimales («1020.00» + código, «55.5» + código): nadie teclea tantos, es un
 * lector que escribió detrás de los decimales de la celda.
 */
export function readScanDigits(text: string) {
  const zone = splitScanText(text)?.zone ?? "";

  return isScannedCode(zone) ? zone : null;
}

/**
 * Un valor tecleado a mano delante de un código: un entero mayor que 0 de hasta 6 dígitos
 * o, con separador decimal («55.5», «0.75», «12.» = 12), ese número a dos decimales.
 */
function readTypedValue(text: string) {
  const parts = splitScanText(text);

  if (!parts || text === "" || text === ".") {
    return null;
  }

  const integerPart = parts.head ? parts.head.slice(0, -1) : parts.zone;

  if (integerPart.length > TYPED_VALUE_MAX_DIGITS) {
    return null;
  }

  const value = roundMoney(
    Number(parts.head ? `${integerPart || "0"}.${parts.zone || "0"}` : integerPart),
  );

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
 * Enter en una celda de línea. `null` = el texto no es un escaneo: sin separador decimal,
 * menos de `PURCHASE_SCAN_MIN_DIGITS` dígitos; con él, menos de esos decimales.
 * `stamps` trae el instante de cada DÍGITO de `text` (el separador no lleva).
 *
 * El texto es «valor opcional + código», y el código es un SUFIJO de la zona de dígitos
 * que sigue al separador decimal (de todo el texto si no hay). Candidatos, sin repetir y
 * hasta `PURCHASE_SCAN_MAX_CANDIDATES`:
 * 1. el sufijo del largo más habitual que quepa (13, 12, 14 u 8 dígitos, en ese orden);
 * 2. el corte que sugiere el tiempo entre teclas, si es toda la zona o mide como un
 *    código habitual (el que acierta con un UPC-A detrás de una cantidad, un ITF-14 o
 *    un código de otro largo);
 * 3. si ese coincide con el primero, el sufijo del siguiente largo habitual.
 * Ningún otro sufijo se consulta: un código inexistente no cuesta más de 4 peticiones.
 */
export function readPurchaseLineScan(
  text: string,
  stamps: number[],
  now: number,
): PurchaseLineScanReading | null {
  const parts = splitScanText(text);

  if (!parts || !isScannedCode(parts.zone)) {
    return null;
  }

  const { head, zone } = parts;
  const digitCount = text.length - (head ? 1 : 0);
  const timed = stamps.length === digitCount;
  const zoneStamps = timed ? stamps.slice(digitCount - zone.length) : [];
  const [likeliest, ...otherSuffixes] = TYPICAL_CODE_LENGTHS.filter(
    (length) => length <= zone.length,
  ).map((length) => zone.slice(zone.length - length));
  const timedCode = readTimedCode(zone, zoneStamps, now);
  // Un tramo final de un largo raro es una ráfaga partida por un atasco, no un código.
  const timedCandidates =
    timedCode === zone || TYPICAL_CODE_LENGTHS.includes(timedCode.length) ? [timedCode] : [];
  // Con separador, lo que hay hasta él se tecleó a mano seguro; de los decimales, los que
  // van seguidos de una pausa.
  const typedDecimals = readHandTypedPrefix(zone, zoneStamps, now);
  const rest = zone.slice(typedDecimals.length);

  return {
    candidates: [
      ...new Set([likeliest, ...timedCandidates, ...otherSuffixes]),
    ].slice(0, PURCHASE_SCAN_MAX_CANDIDATES),
    // Detrás de los decimales tecleados debe quedar un código entero; y si no hay ninguno
    // con pausa, lo que queda no puede ser más largo que el código más habitual.
    typedUnclear:
      head !== "" &&
      (!timed ||
        !isScannedCode(rest) ||
        (typedDecimals === "" && rest.length > TYPICAL_CODE_LENGTHS[0])),
    typedValue: readTypedValue(`${head}${typedDecimals}`),
  };
}

/**
 * El valor de la celda cuando `code` (un sufijo de `text`) resultó ser el código: lo que
 * queda delante, si es un entero mayor que 0 de hasta 6 dígitos o un decimal («55.5»;
 * «12.» = 12). `null` = no se tecleó ninguno que valga.
 */
export function readValueBeforeCode(text: string, code: string) {
  return readTypedValue(text.slice(0, text.length - code.length));
}
