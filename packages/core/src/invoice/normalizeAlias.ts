/**
 * Normaliza el texto de una línea de factura (o un alias guardado) para
 * poder compararlo de forma estable al emparejar con productos.
 *
 * Reglas, en orden:
 * 1. Minúsculas (`toLowerCase`, antes de descomponer, para que letras como
 *    "İ" no dejen marcas sueltas).
 * 2. Descomposición NFD y eliminación de todas las marcas combinantes
 *    (`\p{M}`): "á" -> "a", "ü" -> "u". Decisión: "ñ" -> "n" (NFD la
 *    descompone en "n" + tilde), igual que el resto de diacríticos.
 * 3. Todo lo que no sea letra (`\p{L}`) ni dígito (`\p{N}`) —puntuación,
 *    símbolos, espacios de cualquier tipo incluido NBSP, tabs y saltos— se
 *    reemplaza por un espacio. Por eso "1.5" -> "1 5" y "P.A.N." -> "p a n":
 *    no se intenta interpretar decimales; es consistente en ambos lados del
 *    emparejamiento.
 * 4. Espacios colapsados a uno y `trim`.
 *
 * Es pura e idempotente: `normalizeAlias(normalizeAlias(x)) === normalizeAlias(x)`.
 * Una entrada vacía o compuesta sólo por símbolos devuelve `""`.
 *
 * @example normalizeAlias("REF.MALTA 1.5 X6") // "ref malta 1 5 x6"
 * @example normalizeAlias("AZÚCAR  Montalbán") // "azucar montalban"
 */
export function normalizeAlias(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
