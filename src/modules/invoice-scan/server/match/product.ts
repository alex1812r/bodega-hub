import { normalizeAlias } from "@bodega/core/invoice";
import { invoiceAliasKey } from "../../invoiceAliasKey";

import type { InvoiceExtractionLine, InvoiceMatchCandidate, InvoiceMatchStatus } from "../../contracts";
import type { MatchAlias, MatchFuzzyCandidate, MatchProduct, MatchSupplierCatalog } from "../match.types";

import { formatDecimal, isPositive, normalizeCode } from "./text";

/** Score mínimo de un alias difuso (trigram) para proponerlo. */
export const FUZZY_ALIAS_MIN_SCORE = 0.6;
/**
 * Bonus de orden para productos vinculados al proveedor resuelto: se suma al
 * score SOLO para ordenar (el `score` devuelto es el de la base). Un vinculado
 * con 0,65 queda delante de un no vinculado con 0,72.
 */
export const LINKED_SUPPLIER_BONUS = 0.1;
/** Candidatos máximos por línea dudosa. */
export const MAX_LINE_CANDIDATES = 3;
const RANK_EPSILON = 1e-9;

export type ProductMatch = {
  /** Estado de la cascada, antes de degradar por empaque, precio o moneda. */
  status: InvoiceMatchStatus;
  /** Solo cuando la cascada identificó UN producto (SKU, alias exacto o barcode único). */
  productId?: string;
  candidates: InvoiceMatchCandidate[];
  /** Alias exacto usado (su `unitsPerPack` resuelve el empaque). */
  alias?: MatchAlias;
  /**
   * Línea por SKU: `alias` no es el de este texto sino otro del mismo producto
   * con el proveedor. Informa del empaque (contradicción, tamaño) pero en modo
   * unidad no gana a la palabra de empaque del texto.
   */
  aliasOfProduct?: boolean;
  /** Paso exacto que identificó el producto (D17: SKU y barcode solo confirman con empaque registrado). */
  via?: "sku" | "alias" | "barcode";
};

export type ProductLookup = {
  /** Catálogo del proveedor resuelto; sin proveedor resuelto, `undefined`. */
  catalog?: MatchSupplierCatalog;
  productsById: Map<string, MatchProduct>;
  products: MatchProduct[];
  fuzzy: MatchFuzzyCandidate[];
  isLinked: (productId: string) => boolean;
};

type Ranked = { candidate: InvoiceMatchCandidate; rank: number };

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function exactCandidates(productIds: string[], lookup: ProductLookup, reason: string): InvoiceMatchCandidate[] {
  return productIds.flatMap((productId) => {
    const product = lookup.productsById.get(productId);
    return product ? [{ productId, name: product.name, score: 1, reason }] : [];
  });
}

function aliasReason(hits: number): string {
  return `alias visto ${hits} ${hits === 1 ? "vez" : "veces"}`;
}

function bySupplierSku(line: InvoiceExtractionLine, lookup: ProductLookup): string[] {
  const code = normalizeCode(line.supplierSku);
  if (!code || !lookup.catalog) {
    return [];
  }
  return unique(
    lookup.catalog.supplierProducts
      .filter((link) => normalizeCode(link.supplierSku) === code)
      .map((link) => link.productId),
  );
}

/**
 * Alias exactos de la línea (puede haber uno por texto, de productos distintos):
 * la clave con la que se aprenden (`invoiceAliasKey`, SCN-UI-Q2), la description y
 * el rawText entero normalizados (clave de los alias aprendidos antes).
 */
function byExactAlias(line: InvoiceExtractionLine, lookup: ProductLookup): MatchAlias[] {
  if (!lookup.catalog) {
    return [];
  }
  const texts = unique(
    [invoiceAliasKey(line), normalizeAlias(line.description), normalizeAlias(line.rawText)].filter(Boolean),
  );
  return lookup.catalog.aliases.filter((alias) => texts.includes(alias.aliasNorm));
}

/**
 * Alias del proveedor que dice cómo factura el producto de una línea casada por
 * SKU (caos A-r3-1, B-r3-1): el alias exacto de este texto hacia ese producto;
 * si no lo hay, los del producto con ese proveedor cuando coinciden en modo
 * (todos en unidad, o todos del mismo tamaño). Mezclados -> ninguno.
 */
function aliasForPack(
  line: InvoiceExtractionLine,
  lookup: ProductLookup,
  productId: string,
): Pick<ProductMatch, "alias" | "aliasOfProduct"> {
  const exact = byExactAlias(line, lookup).find((alias) => alias.productId === productId);
  if (exact) {
    return { alias: exact };
  }
  const own = (lookup.catalog?.aliases ?? []).filter((alias) => alias.productId === productId);
  const sizes = new Set(own.map((alias) => (isPositive(alias.unitsPerPack) ? alias.unitsPerPack : null)));
  if (sizes.size !== 1) {
    return {};
  }
  return { alias: own.reduce((best, alias) => (alias.hits > best.hits ? alias : best)), aliasOfProduct: true };
}

function byBarcode(line: InvoiceExtractionLine, lookup: ProductLookup): string[] {
  const code = normalizeCode(line.barcode);
  if (!code) {
    return [];
  }
  return lookup.products.filter((product) => normalizeCode(product.barcode) === code).map((product) => product.id);
}

function rankFuzzy(lookup: ProductLookup): Ranked[] {
  const best = new Map<string, Ranked>();

  for (const fuzzy of lookup.fuzzy) {
    const product = lookup.productsById.get(fuzzy.productId);
    if (!product || !Number.isFinite(fuzzy.score) || fuzzy.score <= 0) {
      continue;
    }
    if (fuzzy.via === "alias" && fuzzy.score < FUZZY_ALIAS_MIN_SCORE) {
      continue;
    }
    if (fuzzy.via === "name" && !product.active) {
      continue;
    }

    const linked = lookup.isLinked(product.id);
    const label = fuzzy.via === "alias" ? "alias parecido" : "nombre parecido";
    const reason = `${label} ${formatDecimal(fuzzy.score)}${linked ? " · vinculado al proveedor" : ""}`;
    const ranked: Ranked = {
      candidate: { productId: product.id, name: product.name, score: fuzzy.score, reason },
      rank: fuzzy.score + (linked ? LINKED_SUPPLIER_BONUS : 0),
    };
    const previous = best.get(product.id);
    if (!previous || ranked.rank > previous.rank) {
      best.set(product.id, ranked);
    }
  }

  return [...best.values()].sort((a, b) => {
    const diff = b.rank - a.rank;
    // Empate (con tolerancia de coma flotante): orden estable por nombre, nunca se elige uno.
    return Math.abs(diff) > RANK_EPSILON ? diff : a.candidate.name.localeCompare(b.candidate.name);
  });
}

function withFuzzyFill(first: InvoiceMatchCandidate[], lookup: ProductLookup): InvoiceMatchCandidate[] {
  const seen = new Set(first.map((candidate) => candidate.productId));
  const extra = rankFuzzy(lookup)
    .map((entry) => entry.candidate)
    .filter((candidate) => !seen.has(candidate.productId));
  return [...first, ...extra].slice(0, MAX_LINE_CANDIDATES);
}

/** Paso exacto con uno o varios productos: uno -> confirmado; varios -> dudosa con todos (6.9). */
function exactStep(candidates: InvoiceMatchCandidate[], alias?: MatchAlias): ProductMatch {
  if (candidates.length === 1) {
    return { status: "confirmed", productId: candidates[0].productId, candidates, alias };
  }
  return { status: "doubtful", candidates: candidates.slice(0, MAX_LINE_CANDIDATES) };
}

/**
 * Cascada de producto de una línea (plan §3 "Emparejamiento"):
 * (1) SKU del proveedor resuelto; (2) alias exacto normalizado de ese
 * proveedor; (3) código de barras único (con proveedor resuelto); (4) alias
 * difuso >= 0,6 o nombre en productos activos -> dudosa con <= 3 candidatos;
 * (5) nada -> sin emparejar. Solo (1)-(3) pueden confirmar; (1) y (3) solo con
 * la línea por unidad o un empaque registrado (D17, lo aplica `matchInvoice`).
 */
export function matchLineProduct(line: InvoiceExtractionLine, lookup: ProductLookup): ProductMatch {
  const skuCandidates = exactCandidates(bySupplierSku(line, lookup), lookup, "SKU del proveedor");
  if (skuCandidates.length > 0) {
    const step = exactStep(skuCandidates);
    if (!step.productId) {
      return step;
    }
    // Alias exacto de este mismo texto hacia OTRO producto: dos señales exactas se contradicen (caos B-r4-2).
    const conflicting = byExactAlias(line, lookup).filter((alias) => alias.productId !== step.productId);
    const aliasCandidates = unique(conflicting.map((alias) => alias.productId)).flatMap((productId) => {
      const hits = conflicting.find((alias) => alias.productId === productId)?.hits ?? 0;
      return exactCandidates([productId], lookup, aliasReason(hits));
    });
    if (aliasCandidates.length > 0) {
      return { status: "doubtful", candidates: [...skuCandidates, ...aliasCandidates].slice(0, MAX_LINE_CANDIDATES) };
    }
    return { ...step, via: "sku", ...aliasForPack(line, lookup, step.productId) };
  }

  const aliases = byExactAlias(line, lookup);
  const aliasProductIds = unique(aliases.map((entry) => entry.productId));
  if (aliasProductIds.length > 1) {
    // description y rawText casan con alias de productos distintos: no se elige uno.
    const conflicting = aliasProductIds.flatMap((productId) => {
      const hits = aliases.find((entry) => entry.productId === productId)?.hits ?? 0;
      return exactCandidates([productId], lookup, aliasReason(hits));
    });
    if (conflicting.length > 1) {
      return exactStep(conflicting);
    }
  }
  // El primer alias cuyo producto sigue en el catálogo (uno puede apuntar a un producto borrado).
  for (const alias of aliases) {
    const aliasCandidates = exactCandidates([alias.productId], lookup, aliasReason(alias.hits));
    if (aliasCandidates.length > 0) {
      return { ...exactStep(aliasCandidates, alias), via: "alias" };
    }
  }

  const barcodeIds = byBarcode(line, lookup);
  if (barcodeIds.length > 0) {
    const candidates = withFuzzyFill(exactCandidates(barcodeIds, lookup, "código de barras"), lookup);
    const single = barcodeIds.length === 1;
    // D17: barcode único con proveedor resuelto confirma; el empaque y el precio lo degradan después.
    return {
      status: single && lookup.catalog ? "confirmed" : "doubtful",
      productId: single ? barcodeIds[0] : undefined,
      candidates,
      ...(single ? { via: "barcode" as const } : {}),
    };
  }

  const fuzzy = withFuzzyFill([], lookup);
  if (fuzzy.length > 0) {
    return { status: "doubtful", candidates: fuzzy };
  }

  return { status: "unmatched", candidates: [] };
}
