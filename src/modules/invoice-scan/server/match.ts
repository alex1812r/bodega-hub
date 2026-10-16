import type {
  InvoiceExtraction,
  InvoiceExtractionLine,
  InvoiceLineMatch,
  InvoiceMatch,
  InvoiceMatchStatus,
} from "../contracts";

import { findDuplicateScan } from "./match/duplicate";
import {
  NO_PRICE_ISSUE,
  USD_DOCUMENT_ISSUE,
  computeTotals,
  hasPrice,
  isUsdDocument,
  lineAmount,
  lineEntryCosts,
  lineValueIssues,
  priceCoherenceIssue,
  resolveRate,
  unitPriceIssue,
} from "./match/money";
import { resolvePack, type PackResolution } from "./match/pack";
import { matchLineProduct, type ProductLookup, type ProductMatch } from "./match/product";
import { resolveSupplier } from "./match/supplier";
import { resolveTaxRateCode, taxPctOf } from "./match/tax";
import type { MatchContext, MatchProduct, MatchSupplierCatalog } from "./match.types";

export type { MatchContext } from "./match.types";

export const INACTIVE_PRODUCT_ISSUE = "El producto está inactivo: actívalo o elige otro.";

type DocumentState = {
  catalog?: MatchSupplierCatalog;
  productsById: Map<string, MatchProduct>;
  rate?: number;
  usd: boolean;
};

function buildLookup(ctx: MatchContext, state: DocumentState, index: number): ProductLookup {
  const linkedIds = new Set(state.catalog?.supplierProducts.map((link) => link.productId) ?? []);
  return {
    catalog: state.catalog,
    productsById: state.productsById,
    products: ctx.products,
    fuzzy: ctx.fuzzy[index] ?? [],
    isLinked: (productId) =>
      linkedIds.has(productId) || state.productsById.get(productId)?.linkedToSupplier === true,
  };
}

/**
 * D17: una línea por SKU o barcode solo confirma por unidad o con un empaque
 * registrado (del proveedor, o la receta del producto con el mismo tamaño). Un
 * empaque que solo sale de otro alias del producto queda dudoso con su tamaño.
 * El alias exacto de este mismo texto sí vale (el paso 2 lo confirmaría igual).
 */
function unregisteredPackIssue(
  productMatch: ProductMatch,
  pack: PackResolution,
  product: MatchProduct | undefined,
): string | undefined {
  if (productMatch.via !== "sku" && productMatch.via !== "barcode") {
    return undefined;
  }
  if (productMatch.alias && !productMatch.aliasOfProduct) {
    return undefined;
  }
  if (pack.entryMode !== "pack" || pack.packUnitId || pack.issues.length > 0) {
    return undefined;
  }
  if (product?.hasRecipe && pack.unitsPerPack === product.recipeUnitsPerPack) {
    return undefined;
  }
  return pack.unitsPerPack !== undefined
    ? `No hay empaque registrado de ${pack.unitsPerPack} unidades para este proveedor: confirma las unidades por empaque.`
    : "No hay empaque registrado para este proveedor: confirma las unidades por empaque.";
}

/** Empaque, precio, moneda o falta de precio degradan una confirmada a dudosa. */
function finalStatus(base: InvoiceMatchStatus, degraded: boolean, forceDoubtful: boolean): InvoiceMatchStatus {
  if (forceDoubtful) {
    return "doubtful";
  }
  return base === "confirmed" && degraded ? "doubtful" : base;
}

function matchLine(
  line: InvoiceExtractionLine,
  index: number,
  ctx: MatchContext,
  state: DocumentState,
): InvoiceLineMatch {
  const productMatch = matchLineProduct(line, buildLookup(ctx, state, index));
  const product = productMatch.productId ? state.productsById.get(productMatch.productId) : undefined;
  // Sin producto identificado, el empaque se resuelve con el primer candidato (sus empaques y receta; SCN-08-F2 · M2).
  const candidateId = productMatch.candidates[0]?.productId;
  const packProduct = product ?? (candidateId ? state.productsById.get(candidateId) : undefined);
  const packUnits =
    packProduct && state.catalog ? state.catalog.packUnits.filter((pack) => pack.productId === packProduct.id) : [];
  const pack = resolvePack({
    line,
    product: packProduct,
    packUnits,
    alias: productMatch.alias,
    aliasOfProduct: productMatch.aliasOfProduct,
  });

  const issues = [...pack.issues, ...lineValueIssues(line)];
  const unregistered = unregisteredPackIssue(productMatch, pack, product);
  if (unregistered) {
    issues.push(unregistered);
  }
  if (product && !product.active) {
    issues.push(INACTIVE_PRODUCT_ISSUE);
  }
  const priceIssue = state.usd
    ? undefined
    : priceCoherenceIssue({
        line,
        // Producto con receta: su último costo es por empaque (create_purchase lo guarda en modo unidad).
        unitsPerPack: product?.hasRecipe ? 1 : pack.unitsPerPack,
        entryMode: pack.entryMode,
        rate: state.rate,
        lastUnitCostRef: product?.lastUnitCostRef,
      });
  if (priceIssue) {
    issues.push(priceIssue);
  }
  // El costo precargado sale de lineTotal; un P.UNIT que no lo explica deja la línea dudosa (caos A-r4-1).
  const unitPriceMismatch = state.usd
    ? undefined
    : unitPriceIssue({ line, unitsPerPack: pack.unitsPerPack, entryMode: pack.entryMode });
  if (unitPriceMismatch) {
    issues.push(unitPriceMismatch);
  }
  const priced = hasPrice(line);
  if (!priced) {
    issues.push(NO_PRICE_ISSUE);
  }
  if (state.usd) {
    issues.push(USD_DOCUMENT_ISSUE);
  }

  const costs = state.usd ? {} : lineEntryCosts(line, state.rate);
  const status = finalStatus(productMatch.status, issues.length > 0, state.usd || !priced);

  return {
    index,
    status,
    ...(productMatch.productId ? { productId: productMatch.productId } : {}),
    ...(productMatch.candidates.length > 0 ? { candidates: productMatch.candidates } : {}),
    entryMode: pack.entryMode,
    ...(pack.packUnitId ? { packUnitId: pack.packUnitId } : {}),
    ...(pack.unitsPerPack !== undefined ? { unitsPerPack: pack.unitsPerPack } : {}),
    ...(pack.disassembleOnReceive ? { disassembleOnReceive: true } : {}),
    taxRateCode: resolveTaxRateCode(line, product, ctx.taxRates),
    ...costs,
    issues,
  };
}

/**
 * Empareja una factura extraída con el catálogo de la tienda. PURA: sin base,
 * sin red y sin reloj; todo sale de `extraction` y `ctx`.
 *
 * REGLA DURA: una línea solo queda `confirmed` si su producto vino por el SKU
 * del proveedor resuelto, por un alias exacto de ese proveedor o por un código
 * de barras único (D17: SKU y barcode, por unidad o con empaque registrado), y
 * no tiene avisos de empaque, precio, moneda ni falta de precio. Sin proveedor
 * resuelto no hay confirmadas.
 */
export function matchInvoice(extraction: InvoiceExtraction, ctx: MatchContext): InvoiceMatch {
  const supplier = resolveSupplier(extraction.supplier, ctx.supplierCandidates);
  const rate = resolveRate(ctx.systemRate, extraction.printedRate);
  const state: DocumentState = {
    catalog: supplier.contactId
      ? (ctx.supplierCatalogs[supplier.contactId] ?? { supplierProducts: [], aliases: [], packUnits: [] })
      : undefined,
    productsById: new Map(ctx.products.map((product) => [product.id, product])),
    rate: rate.used,
    usd: isUsdDocument(extraction),
  };

  const lines = extraction.lines.map((line, index) => matchLine(line, index, ctx, state));

  let computedNet = 0;
  let computedWithTax = 0;
  extraction.lines.forEach((line, index) => {
    const amount = lineAmount(line);
    computedNet += amount;
    computedWithTax += amount * (1 + taxPctOf(lines[index].taxRateCode, ctx.taxRates) / 100);
  });

  const duplicateOfScanId = findDuplicateScan({
    number: extraction.number,
    date: extraction.date,
    total: extraction.total,
    contactId: supplier.contactId,
    taxId: extraction.supplier.taxId,
    previousScans: ctx.previousScans,
  });

  return {
    supplier,
    lines,
    totals: computeTotals(extraction, computedNet, computedWithTax),
    ...(rate.info ? { rate: rate.info } : {}),
    ...(duplicateOfScanId ? { duplicateOfScanId } : {}),
  };
}
