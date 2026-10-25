/**
 * INT-01 · `MatchContext` del modo mock (`API_DATA_SOURCE=mock`), con paridad
 * razonable de `loadMatchContext` (20261019d + consultas por tienda):
 * - proveedores: contactos activos proveedor / ambos de la tienda con RIF
 *   normalizado igual al leído o nombre parecido (≥ 0,3), máximo 5;
 * - catálogo de TODOS esos candidatos (la base carga solo el más probable;
 *   `matchInvoice` usa únicamente el del proveedor que resuelve), con sus
 *   empaques activos y los alias aprendidos en `confirmScan.mock-server.ts`;
 * - difusos por línea: productos activos con nombre parecido (≥ 0,6) a la
 *   descripción y alias del proveedor más probable parecidos a la clave de
 *   alias de la línea (`invoiceAliasKey`, SCN-UI-Q2);
 *   a las líneas sin ninguno, segunda pasada con los textos limpios de
 *   `searchTextVariants` (como `loadVariantFuzzy`, SCN-11-it1);
 * - alícuotas activas de la tienda, tasa del día (`getCurrentExchangeRate`
 *   mock, la del formulario de compra) y escaneos previos con el mismo número
 *   normalizado.
 *
 * Diferencias asumidas: la similitud es la de bigramas de `textSimilarity`
 * (no la de trigramas de pg_trgm) y el último costo es `currentCostRef` del
 * producto (no la última línea recibida).
 */
import { normalizeAlias } from "@bodega/core/invoice";
import { invoiceAliasKey } from "../invoiceAliasKey";

import { getCurrentExchangeRate } from "@/modules/settings/services/exchangeRates.mock-server";
import { mockTaxRatesForStore } from "@/modules/settings/services/taxRates.mock-server";
import {
  mockAppSettings,
  mockCategories,
  mockContacts,
  mockProductPackConversions,
  mockProducts,
  mockSupplierProducts,
} from "@/shared/mocks/erp-data";
import { listActiveMockPackUnitsOfLink } from "@/modules/contacts/services/supplierProducts.mock-server";
import { findMockPurchase } from "@/modules/purchases/services/purchaseMockStore";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import type { InvoiceExtraction } from "../contracts";

import { listMockLearnedAliases } from "./confirmScan.mock-server";
import {
  contactTaxIdsOf,
  duplicateSupplierParams,
  type DuplicateSupplierFilter,
  MATCH_CANDIDATES_MAX_TEXTS,
  MATCH_CANDIDATES_PER_LINE,
  PREVIOUS_SCANS_LIMIT,
  readDuplicateSupplier,
  taxRateKind,
} from "./loadMatchContext";
import type {
  InvoiceLastUnitCost,
  MatchContext,
  MatchFuzzyCandidate,
  MatchPreviousScan,
  MatchProduct,
  MatchSupplierCandidate,
  MatchSupplierCatalog,
} from "./match.types";
import { lastUnitCostRefOf } from "./match/money";
import { searchTextVariants } from "./match/searchText";
import { normalizeInvoiceNumber, normalizeTaxId, sameTaxId, textSimilarity } from "./match/text";
import { listMockScansOfStore } from "./scans.mock-server";

/** Mismos umbrales que `invoice_match_candidates` (20261019d). */
const SUPPLIER_MIN_SCORE = 0.3;
const SUPPLIER_MAX = 5;
const FUZZY_MIN_SCORE = 0.6;

const ofStore = (rowStoreId: string | null | undefined, storeId: string) => (rowStoreId ?? DEFAULT_STORE_ID) === storeId;

function supplierCandidates(storeId: string, extraction: InvoiceExtraction): MatchSupplierCandidate[] {
  const name = extraction.supplier.name ?? "";

  return mockContacts
    .filter((contact) => ofStore(contact.storeId, storeId) && contact.isActive && contact.type !== "cliente")
    .map((contact) => ({
      contactId: contact.id,
      name: contact.name,
      taxId: contact.taxId || null,
      score: textSimilarity(contact.name, name),
      taxIdMatch: sameTaxId(extraction.supplier.taxId, contact.taxId),
    }))
    .filter((row) => row.taxIdMatch || row.score >= SUPPLIER_MIN_SCORE)
    .sort((a, b) => Number(b.taxIdMatch) - Number(a.taxIdMatch) || b.score - a.score)
    .slice(0, SUPPLIER_MAX)
    .map(({ contactId, name, taxId, score }) => ({ contactId, name, taxId, score }));
}

function catalogOf(storeId: string, supplierId: string): MatchSupplierCatalog {
  const links = mockSupplierProducts.filter(
    (link) => ofStore(link.storeId, storeId) && link.supplierId === supplierId && link.isActive !== false,
  );

  return {
    supplierProducts: links.map((link) => ({
      supplierProductId: link.id,
      productId: link.productId,
      supplierSku: link.supplierSku ?? null,
      isPreferred: link.isPreferred === true,
    })),
    // Estado vivo del mock: incluye los empaques que crean compras y escaneos (SCN-08-F2 · 6.8).
    packUnits: links.flatMap((link) =>
      listActiveMockPackUnitsOfLink(link.id).map((pack) => ({
          id: pack.id,
          productId: link.productId,
          label: pack.label,
          unitsPerPack: pack.unitsPerPack,
          isDefault: pack.isDefault === true,
        })),
    ),
    aliases: listMockLearnedAliases(storeId, supplierId).map((alias) => ({
      aliasNorm: alias.aliasNorm,
      productId: alias.productId,
      packLabel: alias.packLabel,
      unitsPerPack: alias.unitsPerPack,
      hits: alias.hits,
    })),
  };
}

function products(storeId: string): MatchProduct[] {
  const rates = mockTaxRatesForStore(storeId);
  const recipes = mockProductPackConversions.filter((recipe) => recipe.storeId === storeId && recipe.isActive);

  return mockProducts
    .filter((product) => ofStore(product.storeId, storeId))
    .map((product) => {
      const category = mockCategories.find((row) => row.id === product.categoryId);
      const recipe = recipes.find((row) => row.packProductId === product.id);
      const componentPackSizes = [
        ...new Set(
          recipes.flatMap((row) =>
            row.components
              .filter((component) => component.unitProductId === product.id && component.unitsPerPack === row.totalUnits)
              .map((component) => component.unitsPerPack),
          ),
        ),
      ].sort((a, b) => a - b);

      return {
        id: product.id,
        name: product.name,
        sku: product.sku || null,
        barcode: product.barcode ?? null,
        active: product.isActive,
        taxRateCode: rates.find((rate) => rate.id === category?.taxRateId)?.code ?? null,
        lastUnitCostRef: product.currentCostRef > 0 ? product.currentCostRef : null,
        hasRecipe: recipe !== undefined,
        ...(recipe ? { recipeUnitsPerPack: recipe.totalUnits } : {}),
        ...(componentPackSizes.length > 0 ? { componentPackSizes } : {}),
      };
    });
}

/** Candidatos de UN texto (alias contra `text`, nombres contra `description`), como una fila de la RPC. */
function candidatesFor(
  text: string,
  description: string,
  catalog: MatchSupplierCatalog | undefined,
  storeProducts: MatchProduct[],
): MatchFuzzyCandidate[] {
  const best = new Map<string, MatchFuzzyCandidate>();
  const offer = (candidate: MatchFuzzyCandidate) => {
    const previous = best.get(candidate.productId);
    // Uno por producto: el mejor; empate -> alias (como la RPC).
    if (!previous || candidate.score > previous.score || (candidate.score === previous.score && candidate.via === "alias")) {
      best.set(candidate.productId, candidate);
    }
  };

  for (const alias of catalog?.aliases ?? []) {
    const score = textSimilarity(alias.aliasNorm, text);
    if (score >= FUZZY_MIN_SCORE) {
      offer({ productId: alias.productId, score, via: "alias" });
    }
  }
  for (const product of storeProducts) {
    const score = product.active ? textSimilarity(product.name, description) : 0;
    if (score >= FUZZY_MIN_SCORE) {
      offer({ productId: product.id, score, via: "name" });
    }
  }

  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, MATCH_CANDIDATES_PER_LINE);
}

function fuzzyCandidates(
  extraction: InvoiceExtraction,
  catalog: MatchSupplierCatalog | undefined,
  storeProducts: MatchProduct[],
): Record<number, MatchFuzzyCandidate[]> {
  const fuzzy: Record<number, MatchFuzzyCandidate[]> = {};

  extraction.lines.forEach((line, index) => {
    const text = invoiceAliasKey(line);
    const description = normalizeAlias(line.description || line.rawText);
    const list = candidatesFor(text, description, catalog, storeProducts);
    if (list.length > 0) {
      fuzzy[index] = list;
    }
  });

  // Segunda pasada (paridad con `loadVariantFuzzy`): solo líneas sin candidatos, mejor score por producto.
  let budget = MATCH_CANDIDATES_MAX_TEXTS;
  extraction.lines.forEach((line, index) => {
    if (fuzzy[index]) {
      return;
    }
    const byProduct = new Map<string, MatchFuzzyCandidate>();
    for (const text of searchTextVariants(line)) {
      if (budget <= 0) {
        break;
      }
      budget -= 1;
      for (const candidate of candidatesFor(text, text, catalog, storeProducts)) {
        const previous = byProduct.get(candidate.productId);
        if (!previous || candidate.score > previous.score) {
          byProduct.set(candidate.productId, candidate);
        }
      }
    }
    const list = [...byProduct.values()].sort((a, b) => b.score - a.score).slice(0, MATCH_CANDIDATES_PER_LINE);
    if (list.length > 0) {
      fuzzy[index] = list;
    }
  });

  return fuzzy;
}

/** Paridad con `loadMatchContext`: la tasa del día del formulario de compra en mock (CIE-02). */
function systemRate(storeId: string): number | undefined {
  const { rateVes } = getCurrentExchangeRate(storeId);

  return Number.isFinite(rateVes) && rateVes > 0 ? rateVes : undefined;
}

/**
 * Paridad mock de `loadContactTaxIds` (REP12-01, D53): RIF guardado de los contactos de la
 * tienda con esos ids (sin repetir; los que no tienen RIF no aportan).
 */
export function listMockContactTaxIds(storeId: string, ids: (string | null | undefined)[]): string[] {
  return [...mockContactTaxIds(storeId, ids).values()];
}

function mockContactTaxIds(storeId: string, ids: (string | null | undefined)[]): Map<string, string> {
  const wanted = new Set(ids.filter((id): id is string => Boolean(id)));
  return new Map(
    mockContacts
      .filter((contact) => wanted.has(contact.id) && ofStore(contact.storeId, storeId) && contact.taxId?.trim())
      .map((contact) => [contact.id, contact.taxId]),
  );
}

/**
 * Paridad mock de `invoice_duplicate_candidates` (REP12-06): el escaneo puede ser del proveedor de
 * la consulta por id (elegido o leído) o por los dígitos del RIF leído o guardado de sus contactos.
 */
function mockScanOfSupplier(
  storeId: string,
  scan: ReturnType<typeof listMockScansOfStore>[number],
  params: ReturnType<typeof duplicateSupplierParams>,
): boolean {
  const ids = [scan.supplierId, scan.matched?.supplier.contactId];
  if (ids.some((id) => typeof id === "string" && params.p_supplier_ids.includes(id))) {
    return true;
  }
  const taxIds = [scan.extracted?.supplier.taxId, ...mockContactTaxIds(storeId, ids).values()];
  return taxIds.some((taxId) => {
    const digits = normalizeTaxId(taxId);
    return digits !== "" && params.p_tax_digits.includes(digits);
  });
}

/**
 * REP12-01: también la usa `POST /api/purchases/invoice-scan/duplicates` en mock (paridad con `loadPreviousScans`).
 * REP12-06: con `supplier`, el proveedor se filtra antes del tope, como `invoice_duplicate_candidates`.
 */
export function listMockPreviousScans(
  storeId: string,
  extraction: Pick<InvoiceExtraction, "number" | "date" | "total">,
  excludeScanId?: string,
  supplier?: DuplicateSupplierFilter,
): MatchPreviousScan[] {
  const number = normalizeInvoiceNumber(extraction.number);
  // Paridad con `loadPreviousScansByDateTotal`: mismo total (±0,01, al céntimo) y fecha si se leyó.
  const total = extraction.total;
  const date = extraction.date?.trim();
  const cents = typeof total === "number" && Number.isFinite(total) && total > 0 && (date || !number) ? Math.round(total * 100) : undefined;
  const supplierParams = supplier ? duplicateSupplierParams(supplier) : undefined;
  const live = listMockScansOfStore(storeId).filter(
    (scan) =>
      scan.id !== excludeScanId &&
      scan.status !== "discarded" &&
      scan.status !== "failed" &&
      (!supplierParams || mockScanOfSupplier(storeId, scan, supplierParams)),
  );
  const byNumber = number
    ? live.filter((scan) => normalizeInvoiceNumber(scan.extracted?.number) === number).slice(0, PREVIOUS_SCANS_LIMIT)
    : [];
  const byDateTotal =
    cents === undefined
      ? []
      : live
          .filter((scan) => {
            const scanTotal = scan.extracted?.total;
            return (
              typeof scanTotal === "number" &&
              Math.abs(Math.round(scanTotal * 100) - cents) <= 1 &&
              (!date || scan.extracted?.date === date)
            );
          })
          .slice(0, PREVIOUS_SCANS_LIMIT);

  const scans = [...byNumber, ...byDateTotal.filter((scan) => !byNumber.includes(scan))];
  const taxIds = mockContactTaxIds(
    storeId,
    scans.flatMap((scan) => [scan.supplierId, scan.matched?.supplier.contactId]),
  );

  return scans.map((scan) => ({
    scanId: scan.id,
    supplierId: scan.supplierId ?? scan.matched?.supplier.contactId ?? null,
    matchedContactId: scan.matched?.supplier.contactId ?? undefined,
    supplierTaxId: scan.extracted?.supplier.taxId ?? null,
    ...contactTaxIdsOf(taxIds, [scan.supplierId, scan.matched?.supplier.contactId]),
    number: scan.extracted?.number ?? null,
    date: scan.extracted?.date,
    total: scan.extracted?.total,
    purchaseId: scan.purchaseId ?? undefined,
    purchaseStatus: scan.purchaseId ? findMockPurchase(scan.purchaseId)?.status : undefined,
  }));
}

/** Contexto de `matchInvoice` para la tienda `storeId` en modo mock. Ver la cabecera. */
export function loadMockMatchContext(
  storeId: string,
  extraction: InvoiceExtraction,
  options?: { excludeScanId?: string },
): MatchContext {
  const suppliers = supplierCandidates(storeId, extraction);
  const supplierCatalogs = Object.fromEntries(suppliers.map((supplier) => [supplier.contactId, catalogOf(storeId, supplier.contactId)]));
  const storeProducts = products(storeId);
  const defaultTaxRateId = (mockAppSettings.storeId ?? DEFAULT_STORE_ID) === storeId ? mockAppSettings.defaultTaxRateId : null;

  return {
    storeId,
    supplierCandidates: suppliers,
    supplierCatalogs,
    products: storeProducts,
    fuzzy: fuzzyCandidates(extraction, suppliers[0] ? supplierCatalogs[suppliers[0].contactId] : undefined, storeProducts),
    taxRates: mockTaxRatesForStore(storeId)
      .filter((rate) => rate.isActive)
      .map((rate) => ({
        code: rate.code,
        pct: rate.pct,
        kind: taxRateKind(rate.code, rate.pct),
        isDefault: rate.id === defaultTaxRateId,
      })),
    systemRate: systemRate(storeId),
    // REP12-06: con el proveedor leído, como `loadMatchContext`.
    previousScans: listMockPreviousScans(storeId, extraction, options?.excludeScanId, readDuplicateSupplier(extraction, suppliers)),
  };
}

/**
 * Paridad mock de `loadLastUnitCostRefs` (D41-a): el último costo por unidad de los productos
 * de la tienda con el mismo criterio que el contexto mock (`currentCostRef`, receta repartida).
 * Uno por id pedido (sin repetidos), `null` si no se conoce o no es de la tienda.
 */
export function listMockLastUnitCostRefs(storeId: string, productIds: string[]): InvoiceLastUnitCost[] {
  const byId = new Map(products(storeId).map((product) => [product.id, product]));

  return [...new Set(productIds)].map((productId) => ({
    productId,
    lastUnitCostRef: lastUnitCostRefOf(byId.get(productId)) ?? null,
  }));
}
