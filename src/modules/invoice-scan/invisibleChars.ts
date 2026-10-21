/**
 * REP3-03b (caos N8 / auditoría B16): única lista de caracteres invisibles del
 * escaneo de facturas. La usan la validación de la extracción corregida
 * (contracts.ts), el saneo de la lectura del modelo (server/extract.ts) y el de
 * los few-shot (server/fewShot.ts). No dupliques la lista en otro sitio.
 *
 * Siempre invisibles:
 * - U+00AD guion blando, U+034F, U+061C, U+180E;
 * - rellenos hangul U+115F, U+1160, U+3164, U+FFA0 (el hangul normal pasa);
 * - Khmer U+17B4, U+17B5;
 * - ancho cero y marcas U+200B, U+200C, U+200E, U+200F; bidi U+202A–U+202E y U+2066–U+2069;
 * - separadores U+2028, U+2029;
 * - U+2060–U+2065 (joiner de palabra y operadores invisibles) y formatos obsoletos U+206A–U+206F;
 * - selectores de variante U+FE00–U+FE0D y U+E0100–U+E01EF;
 * - BOM U+FEFF, anotaciones interlineales U+FFF9–U+FFFB;
 * - notación musical U+1D173–U+1D17A, braille vacío U+2800 y tags U+E0000–U+E007F.
 *
 * Según el contexto (para no romper emoji):
 * - U+200D fuera de una secuencia de emoji;
 * - U+FE0E/U+FE0F que no siguen a un pictograma ni forman un keycap (dígito + U+FE0F + U+20E3).
 */
const ALWAYS_INVISIBLE =
  "\\u00ad\\u034f\\u061c\\u115f\\u1160\\u17b4\\u17b5\\u180e\\u200b\\u200c\\u200e\\u200f\\u2028-\\u202e" +
  "\\u2060-\\u2064\\u2065\\u2066-\\u206f\\u2800\\u3164\\ufe00-\\ufe0d\\ufeff\\uffa0\\ufff9-\\ufffb" +
  "\\u{1d173}-\\u{1d17a}\\u{e0000}-\\u{e007f}\\u{e0100}-\\u{e01ef}";
const LOOSE_ZERO_WIDTH_JOINER =
  "(?<![\\p{Extended_Pictographic}\\p{Emoji_Modifier}\\ufe0f])\\u200d|\\u200d(?!\\p{Extended_Pictographic})";
const LOOSE_EMOJI_VARIATION_SELECTOR = "(?<!\\p{Extended_Pictographic})[\\ufe0e\\ufe0f](?!\\u20e3)";

const INVISIBLE_SOURCE = `[${ALWAYS_INVISIBLE}]|${LOOSE_ZERO_WIDTH_JOINER}|${LOOSE_EMOJI_VARIATION_SELECTOR}`;

const INVISIBLE_CHAR = new RegExp(INVISIBLE_SOURCE, "u");

/** ¿Tiene el texto algún invisible de la lista (o un U+200D/U+FE0F suelto)? */
export function hasInvisibleChar(value: string): boolean {
  return INVISIBLE_CHAR.test(value);
}

/**
 * Sustituye cada invisible por `replacement` (por defecto lo quita). U+2028/U+2029
 * pasan a salto de línea. Los emoji (con U+200D o U+FE0F) se conservan.
 */
export function replaceInvisibleChars(value: string, replacement = ""): string {
  return value.replace(/[\u2028\u2029]/gu, "\n").replace(new RegExp(INVISIBLE_SOURCE, "gu"), replacement);
}
