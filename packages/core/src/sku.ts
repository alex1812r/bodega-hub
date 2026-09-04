const SKU_STOP_WORDS = new Set([
  "a",
  "al",
  "de",
  "del",
  "e",
  "el",
  "en",
  "la",
  "las",
  "lo",
  "los",
  "y",
]);

const SUPPLIER_STOP_WORDS = SKU_STOP_WORDS;

const LEGAL_TOKEN_PATTERN = /^(ca|sa|srl|cia|c\.a|s\.a)$/i;

const LEGAL_SUFFIX_PATTERN =
  /\b(c\.?\s*a\.?|s\.?\s*a\.?|s\.?\s*rl\.?|c\.?\s*a\.?\s*s\.?\s*a\.?)\s*\.?\s*$/gi;

function normalizeSkuText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-zA-Z0-9\s.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string, stopWords: Set<string>) {
  return normalizeSkuText(value)
    .toLowerCase()
    .split(" ")
    .map((word) => word.replace(/\./g, ""))
    .filter((word) => word.length > 0 && !stopWords.has(word));
}

function abbreviateToken(token: string, maxLength: number) {
  if (token.length <= maxLength) {
    return token;
  }

  return token.slice(0, maxLength);
}

export function normalizeSku(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeOptionalSku(value: string | null | undefined) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed.toLowerCase();
}

export function generateProductSkuFromName(name: string, maxLength = 32) {
  const tokens = tokenize(name, SKU_STOP_WORDS);

  if (tokens.length === 0) {
    return "producto";
  }

  const parts = tokens.map((token) => abbreviateToken(token, 4));
  const sku = parts.join("-");

  return sku.slice(0, maxLength) || "producto";
}

export function shortenSupplierName(name: string, maxLength = 8) {
  const cleaned = normalizeSkuText(name).replace(LEGAL_SUFFIX_PATTERN, "").trim();
  const tokens = tokenize(cleaned, SUPPLIER_STOP_WORDS).filter(
    (token) => !LEGAL_TOKEN_PATTERN.test(token),
  );

  if (tokens.length === 0) {
    const fallback = cleaned.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    return (fallback || "prov").slice(0, maxLength);
  }

  if (tokens.length === 1) {
    return abbreviateToken(tokens[0], maxLength);
  }

  if (tokens.length === 2) {
    return `${abbreviateToken(tokens[0], 3)}${abbreviateToken(tokens[1], 3)}`.slice(0, maxLength);
  }

  const initials = tokens.map((token) => token[0] ?? "").join("");

  if (initials.length >= 3) {
    return initials.slice(0, maxLength);
  }

  const hybrid = `${abbreviateToken(tokens[0], 4)}${tokens
    .slice(1)
    .map((token) => token[0] ?? "")
    .join("")}`;

  return hybrid.slice(0, maxLength) || "prov";
}

export function generateSupplierSkuFromProduct(productSku: string, supplierName: string) {
  const normalizedProductSku = normalizeSku(productSku);
  const supplierShort = shortenSupplierName(supplierName);

  if (!normalizedProductSku) {
    return supplierShort;
  }

  return `${normalizedProductSku}-${supplierShort}`.slice(0, 48);
}
