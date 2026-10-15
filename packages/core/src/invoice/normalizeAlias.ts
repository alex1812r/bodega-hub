/** Invisibles que parten palabras sin ser separadores: ZWSP, ZWNJ, ZWJ, word joiner, BOM y soft hyphen. */
const INVISIBLE = /[​-‍⁠﻿­]/g;

/**
 * Normaliza el texto de una línea de factura (o un alias guardado) para
 * poder compararlo de forma estable al emparejar con productos.
 *
 * Reglas, en orden:
 * 1. Se eliminan, sin insertar espacio, los invisibles que parten palabras:
 *    zero-width (U+200B, U+200C, U+200D), word joiner (U+2060), BOM (U+FEFF)
 *    y soft hyphen (U+00AD). "MAL​TA" -> "malta".
 * 2. Descomposición de compatibilidad NFKD: pliega ancho completo
 *    ("ＭＡＬＴＡ" -> "MALTA"), ligaduras ("ﬁ" -> "fi"), letras estilizadas
 *    ("ℌ" -> "H") y fracciones ("½" -> "1⁄2"), y separa los diacríticos.
 * 3. Minúsculas (`toLowerCase`, después de NFKD para cubrir lo que NFKD
 *    devuelve en mayúscula; "İ" queda como "i" + marca, que se elimina luego).
 * 4. Eliminación de todas las marcas combinantes (`\p{M}`): "á" -> "a",
 *    "ü" -> "u". Decisión: "ñ" -> "n" (NFKD la descompone en "n" + tilde),
 *    igual que el resto de diacríticos.
 * 5. Todo lo que no sea letra (`\p{L}`) ni dígito (`\p{N}`) —puntuación,
 *    símbolos, espacios de cualquier tipo incluido NBSP, tabs y saltos— se
 *    reemplaza por un espacio. Por eso "1.5" -> "1 5" y "P.A.N." -> "p a n":
 *    no se intenta interpretar decimales; es consistente en ambos lados del
 *    emparejamiento.
 * 6. Espacios colapsados a uno y `trim`.
 *
 * Es pura e idempotente: `normalizeAlias(normalizeAlias(x)) === normalizeAlias(x)`.
 * Una entrada vacía o compuesta sólo por símbolos o invisibles devuelve `""`.
 *
 * @example normalizeAlias("REF.MALTA 1.5 X6") // "ref malta 1 5 x6"
 * @example normalizeAlias("AZÚCAR  Montalbán") // "azucar montalban"
 * @example normalizeAlias("ＭＡＬＴＡ ﬁno") // "malta fino"
 */
export function normalizeAlias(text: string): string {
  return text
    .replace(INVISIBLE, "")
    .normalize("NFKD")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
