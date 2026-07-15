/**
 * Quita del nombre del producto la cantidad de empaque (caja/paquete),
 * conservando presentación unitaria (peso, volumen, variantes).
 */

const UNIT_SIZE_PATTERN =
  /\d+(?:[.,]\d+)?\s*(?:GRS?|G|ML|LTS?|LT|KG|KGR|CM|CL|CC)\b\.?/i;

const PACK_COUNT_TOKEN =
  /\b\d+\s*(?:U|UNID|UNDS|UND|SOBRES|PAQUETICOS|TIRAS|PACK|TACO|TACOS)\b/gi;

/** NxTamaño → Tamaño (ej. 12X28GR → 28GR, 24X250ML → 250ML) */
const PACK_COUNT_TIMES_SIZE =
  /\b\d+\s*[xX]\s*(?=\d+(?:[.,]\d+)?(?:\s*(?:GRS?|G|ML|LTS?|LT|KG|KGR|CM|CL|CC)\b\.?))/gi;

/** N UNID X Tamaño → Tamaño (ej. 8UNID X30GR → 30GR) */
const PACK_UNID_TIMES_SIZE = /\b\d+\s*UNID\s*[xX]\s*(?=\d+)/gi;

/** Marcadores del listado mayorista entre paréntesis — no forman parte del producto */
const LISTING_PAREN_VARIANT = /\s*\((?:GENERAL|PEQUEÑ[OA])\)\s*/gi;

function normalizeWhitespace(name) {
  return name
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+\)/g, ')')
    .replace(/\(\s+/g, '(')
    .trim();
}

function cleanProductName(description) {
  let name = description.trim();

  name = name.replace(PACK_COUNT_TIMES_SIZE, '');
  name = name.replace(PACK_UNID_TIMES_SIZE, '');
  name = name.replace(PACK_COUNT_TOKEN, '');
  name = name.replace(LISTING_PAREN_VARIANT, ' ');
  name = normalizeWhitespace(name);

  return name;
}

function buildProductSku(cleanName) {
  return cleanName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

/** Regex compartida para detectar empaques múltiples en la línea original */
const PACK_DETECTION_REGEX =
  /(?:(\d+)\s*[xX]\s*(?:\d+(?:[.,]\d+)?(?:\s*(?:GRS?|G|ML|LTS?|LT|KG|KGR|CM|CL|CC)\b\.?)?))|(?:(\d+)\s*(?:U|UNID|UNDS|SOBRES|PAQUETICOS|UND|TIRAS|PACK|TACO|TACOS))\b/i;

module.exports = {
  PACK_DETECTION_REGEX,
  buildProductSku,
  cleanProductName,
  UNIT_SIZE_PATTERN,
};
