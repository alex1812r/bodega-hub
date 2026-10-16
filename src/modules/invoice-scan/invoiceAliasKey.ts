import { normalizeAlias } from "@bodega/core/invoice";

/**
 * Número con formato de dinero o de cantidad impresa: con exactamente dos
 * decimales ("1,00", "4358.64", "15,00") o con separador de miles
 * ("4.358,64", "1.000", "12,345.6"). Un número sin esos rasgos ("1,5", "2",
 * "500") se conserva: puede ser un tamaño de presentación ("JUSTY 1,5").
 */
const MONEY_NUMBER = /^(?:\d+[.,]\d{2}|\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?)$/;
/** Moneda suelta: "Bs", "Bs.", "BsF", "BsS", "VES", "REF", "USD", "$". */
const CURRENCY = /^(?:bs[fs]?|ves|ref|usd|\$)$/i;
/** Signo de multiplicar suelto entre cantidad y precio ("1,00 x 4.358,64"). */
const TIMES = /^(?:x|×|\*|@)$/i;
/** Signos que envuelven tokens sin ser parte de ellos: "[CAJA", "15,00]", "(E)", "Bs.". */
const EDGE_PUNCTUATION = /^[[\](){}|#:;"']+|[[\](){}|#:;"'.,]+$/g;

function isNoise(token: string): boolean {
  const core = token.replace(EDGE_PUNCTUATION, "");
  return core === "" ? false : MONEY_NUMBER.test(core) || CURRENCY.test(core) || TIMES.test(core);
}

/**
 * `rawText` sin los tokens que cambian entre lecturas de la misma línea:
 * números con formato de dinero/cantidad impresa (`MONEY_NUMBER`), monedas
 * sueltas (`CURRENCY`) y el signo de multiplicar suelto (`TIMES`); el resto,
 * normalizado con `normalizeAlias`.
 *
 * Se conservan los tamaños de presentación pegados a su unidad o al signo
 * ("1L", "500G", "400ML", "X12", "1.5L") y los números sin formato de dinero
 * ("1,5", "2", "500"): pueden distinguir un producto de otro. Una cantidad
 * entera impresa sin decimales ("2 x ...") también se conserva; eso solo
 * resta estabilidad (otro alias), nunca confunde productos.
 *
 * @example stableRawText("GLUP COLA 2L 1,00 x 5.173,34 Bs 5.173,34 [BULTO X 6,00]") // "glup cola 2l bulto"
 * @example stableRawText("JUSTY 1,5 X12 2,00 x 9.570,85") // "justy 1 5 x12"
 */
export function stableRawText(rawText: string): string {
  const kept = rawText.split(/\s+/).filter((token) => token !== "" && !isNoise(token));
  return normalizeAlias(kept.join(" "));
}

/**
 * Clave con la que se aprende y se busca el alias de una línea de factura
 * (`supplier_product_aliases.alias_norm`, plan §4 "texto literal normalizado"):
 *
 * 1. La `description` normalizada (`normalizeAlias`) si tiene al menos una
 *    letra: es el nombre del producto tal como lo imprime el proveedor y el
 *    modelo lo repite igual entre fotos.
 * 2. Si no, el `rawText` sin cantidades, precios, importes ni monedas
 *    (`stableRawText`).
 *
 * El `rawText` entero (`normalizeAlias(rawText)`) fue la clave anterior: trae
 * cantidad e importes y no se repite entre lecturas. Quien busque alias debe
 * probar también esa clave para encontrar los aprendidos antes.
 *
 * Pura e idempotente sobre su salida (`normalizeAlias`); "" si no queda texto.
 */
export function invoiceAliasKey(line: { rawText: string; description?: string | null }): string {
  const description = normalizeAlias(line.description ?? "");
  if (/\p{L}/u.test(description)) {
    return description;
  }
  return stableRawText(line.rawText);
}
