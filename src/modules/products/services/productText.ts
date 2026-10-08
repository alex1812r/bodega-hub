const TAB = 0x09;
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;

function isControlCodePoint(codePoint: number) {
  if (codePoint === TAB || codePoint === LINE_FEED || codePoint === CARRIAGE_RETURN) {
    return false;
  }

  // C0 (incluye NUL), DEL y C1.
  return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
}

/**
 * Quita de un texto que llega del cliente el carácter NUL y los demás caracteres
 * de control no imprimibles: Postgres rechaza NUL en `text` y la petición salía
 * como 500. Conserva tabulador y saltos de línea, tildes, ñ y emoji.
 */
export function stripControlChars(value: string): string {
  let clean = "";

  for (const char of value) {
    if (!isControlCodePoint(char.codePointAt(0) ?? 0)) {
      clean += char;
    }
  }

  return clean;
}
