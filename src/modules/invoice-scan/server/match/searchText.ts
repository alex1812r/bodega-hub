import { normalizeAlias } from "@bodega/core/invoice";
import { invoiceAliasKey } from "../../invoiceAliasKey";

import type { InvoiceExtractionLine } from "../../contracts";

/** Marcadores del sistema del proveedor: `[BULTO X 15,00]`, `|[DOC X 12.0]|`, `#[1x3] #`, `(E)`/`(P)`/`(G)`. */
const MARKERS = [/\[[^\]]*\]/g, /\|[^|]*\|/g, /#[^#]*#/g, /\(\s*[EGP]\s*\)/gi];
/** Palabras de empaque o de canal sueltas (ya normalizadas, con límites de palabra). */
const PACK_WORDS =
  /\b(?:bultos?|btos?|cajas?|cjs?|cja|displays?|doc|docenas?|paquetes?|paqs?|pqt|fardos?|tira|ristras?|blisters?|mayor)\b/g;
/** Tamaño del empaque: "x 15 00", "x20", "24und", "100u", "20pc". */
const PACK_SIZES = [/\bx ?\d+(?: \d+)?\b/g, /\b\d+ ?(?:unds?|uds?|u|pcs?)\b/g];
/** Prefijo "N x" de "6x1 75" o "12x50gr": el tamaño de la unidad queda. */
const PACK_PREFIX = /\b\d+x(?=\d)/g;
/** Relleno que no está en los nombres del catálogo ("AXION EN CREMA", "LIGHT EN 222ML"). */
const FILLER = /\ben\b/g;

function clean(text: string): string {
  let result = text;
  for (const marker of MARKERS) {
    result = result.replace(marker, " ");
  }
  result = normalizeAlias(result).replace(PACK_WORDS, " ");
  for (const size of PACK_SIZES) {
    result = result.replace(size, " ");
  }
  return result.replace(PACK_PREFIX, " ").replace(FILLER, " ").replace(/\s+/g, " ").trim();
}

/** "400ml" -> "400 ml", "1kg" -> "1 kg": los nombres del catálogo suelen separar la unidad. */
function splitUnits(text: string): string {
  return text.replace(/(\d)(\p{L})/gu, "$1 $2").replace(/(\p{L})(\d)/gu, "$1 $2");
}

/**
 * Textos alternativos para pedir candidatos difusos de una línea que no trajo
 * ninguno: description y rawText sin marcadores de empaque, prefijos, tamaño de
 * empaque ni relleno, tal cual y con la unidad separada del número. Ya
 * normalizados (`normalizeAlias`), sin repetir los que se mandan en la primera
 * llamada (`invoiceAliasKey(line)` y `normalizeAlias(description)`). Solo
 * alimentan la búsqueda difusa: lo que salga es dudosa, nunca confirmada.
 */
export function searchTextVariants(line: Pick<InvoiceExtractionLine, "rawText" | "description">): string[] {
  const sent = new Set([invoiceAliasKey(line), normalizeAlias(line.description || line.rawText)]);
  const variants = [line.description, line.rawText].flatMap((text) => {
    const cleaned = clean(text ?? "");
    return [cleaned, splitUnits(cleaned)];
  });
  return [...new Set(variants)].filter((text) => text && !sent.has(text));
}
