/**
 * REP3-03b (caos N8 / auditoría B16): única definición de caracteres invisibles
 * del escaneo de facturas. La usan la validación de la extracción corregida
 * (contracts.ts), el saneo de la lectura del modelo (server/extract.ts) y el de
 * los few-shot (server/fewShot.ts). No la dupliques en otro sitio.
 *
 * REP4-02a (caos N8r / auditoría B16 / D29): veto por propiedades Unicode, no
 * por lista. Siempre invisibles:
 * - todo `\p{Cf}` (ancho cero, bidi, BOM, tags, anotaciones, signos numéricos
 *   árabes, controles de taquigrafía, formatos egipcios…);
 * - todo `\p{Default_Ignorable_Code_Point}` (guion blando, U+034F, rellenos
 *   hangul, Khmer U+17B4/U+17B5, selectores de variante y mongoles…);
 * - además, separadores U+2028/U+2029 y braille vacío U+2800.
 *
 * Única excepción, según el contexto (para no romper emoji):
 * - U+200D fuera de una secuencia de emoji;
 * - U+FE0E/U+FE0F que no siguen a un pictograma ni forman un keycap (dígito + U+FE0F + U+20E3).
 */
const ALWAYS_INVISIBLE =
  "(?![\\u200d\\ufe0e\\ufe0f])[\\p{Cf}\\p{Default_Ignorable_Code_Point}\\u2028\\u2029\\u2800]";
const LOOSE_ZERO_WIDTH_JOINER =
  "(?<![\\p{Extended_Pictographic}\\p{Emoji_Modifier}\\ufe0f])\\u200d|\\u200d(?!\\p{Extended_Pictographic})";
const LOOSE_EMOJI_VARIATION_SELECTOR = "(?<!\\p{Extended_Pictographic})[\\ufe0e\\ufe0f](?!\\u20e3)";

const INVISIBLE_SOURCE = `${ALWAYS_INVISIBLE}|${LOOSE_ZERO_WIDTH_JOINER}|${LOOSE_EMOJI_VARIATION_SELECTOR}`;

const INVISIBLE_CHAR = new RegExp(INVISIBLE_SOURCE, "u");

/** ¿Tiene el texto algún invisible (o un U+200D/U+FE0F suelto)? */
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
