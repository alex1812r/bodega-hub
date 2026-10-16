/**
 * INT-01 · `MatchContext` del modo mock (`API_DATA_SOURCE=mock`), con paridad
 * razonable de `loadMatchContext` (20261019d + consultas por tienda):
 * - proveedores: contactos activos proveedor / ambos de la tienda con RIF
 *   normalizado igual al leído o nombre parecido (≥ 0,3), máximo 5;
 * - catálogo de TODOS esos candidatos (la base carga solo el más probable;
 *   `matchInvoice` usa únicamente el del proveedor que resuelve), con sus
 *   empaques activos y los alias aprendidos en `confirmScan.mock-server.ts`;
 * - difusos por línea: productos activos con nombre parecido (≥ 0,6) a la
 *   descripción y alias del proveedor más probable parecidos al `rawText`;
 * - alícuotas activas de la tienda, tasa vigente y escaneos previos con el
 *   mismo número normalizado.
 *
 * Diferencias asumidas: la similitud es la de bigramas de `textSimilarity`
 * (no la de trigramas de pg_trgm) y el último costo es `currentCostRef` del
 * producto (no la última línea recibida).
 */
import { normalizeAlias } from "@bodega/core/invoice";

import { mockTaxRatesForStore } from "@/modules/settings/services/taxRates.mock-server";
import {
  mockAppSettings,
  mockCategories,
  mockContacts,
  mockExchangeRates,
  mockProductPackConversions,
  mockProducts,
  mockSupplierProductPackUnits,
  mockSupplierProducts,
} from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import type { InvoiceExtraction } from "../contracts";

import { listMockLearnedAliases } from "./confirmScan.mock-server";
import { MATCH_CANDIDATES_PER_LINE, PREVIOUS_SCANS_LIMIT, taxRateKind } from "./loadMatchContext";
import type {
  MatchContext,
  MatchFuzzyCandidate,
  MatchPreviousScan,
  MatchProduct,
  MatchSupplierCandidate,
  MatchSupplierCatalog,
} from "./match.types";
import { normalizeInvoiceNumber, normalizeTaxId, textSimilarity } from "./match/text";
import { listMockScansOfStore } from "./scans.mock-server";

/** Mismos umbrales que `invoice_match_candidates` (20261019d). */
const SUPPLIER_MIN_SCORE = 0.3;
const SUPPLIER_MAX = 5;
const FUZZY_MIN_SCORE = 0.6;

const ofStore = (rowStoreId: string | null | undefined, storeId: string) => (rowStoreId ?? DEFAULT_STORE_ID) === storeId;

function supplierCandidates(storeId: string, extraction: InvoiceExtraction): MatchSupplierCandidate[] {
  const readTaxId = normalizeTaxId(extraction.supplier.taxId);
  const name = extraction.supplier.name ?? "";

  return mockContacts
    .filter((contact) => ofStore(contact.storeId, storeId) && contact.isActive && contact.type !== "cliente")
    .map((contact) => ({
      contactId: contact.id,
      name: contact.name,
      taxId: contact.taxId || null,
      score: textSimilarity(contact.name, name),
      taxIdMatch: readTaxId !== "" && normalizeTaxId(contact.taxId) === readTaxId,
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
    packUnits: links.flatMap((link) =>
      mockSupplierProductPackUnits
        .filter((pack) => pack.supplierProductId === link.id && pack.isActive !== false)
        .map((pack) => ({
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

function fuzzyCandidates(
  extraction: InvoiceExtraction,
  catalog: MatchSupplierCatalog | undefined,
  storeProducts: MatchProduct[],
): Record<number, MatchFuzzyCandidate[]> {
  const fuzzy: Record<number, MatchFuzzyCandidate[]> = {};

  extraction.lines.forEach((line, index) => {
    const text = normalizeAlias(line.rawText);
    const description = normalizeAlias(line.description || line.rawText);
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

    const list = [...best.values()].sort((a, b) => b.score - a.score).slice(0, MATCH_CANDIDATES_PER_LINE);
    if (list.length > 0) {
      fuzzy[index] = list;
    }
  });

  return fuzzy;
}

function systemRate(storeId: string): number | undefined {
  const latest = mockExchangeRates
    .filter((rate) => ofStore(rate.storeId, storeId))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];

  return latest && latest.rateVes > 0 ? latest.rateVes : undefined;
}

function previousScans(storeId: string, extraction: InvoiceExtraction, excludeScanId?: string): MatchPreviousScan[] {
  const number = normalizeInvoiceNumber(extraction.number);
  if (!number) {
    return [];
  }

  return listMockScansOfStore(storeId)
    .filter(
      (scan) =>
        scan.id !== excludeScanId &&
        scan.status !== "discarded" &&
        scan.status !== "failed" &&
        normalizeInvoiceNumber(scan.extracted?.number) === number,
    )
    .slice(0, PREVIOUS_SCANS_LIMIT)
    .map((scan) => ({
      scanId: scan.id,
      supplierId: scan.supplierId ?? scan.matched?.supplier.contactId ?? null,
      supplierTaxId: scan.extracted?.supplier.taxId ?? null,
      number: scan.extracted?.number ?? null,
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
    previousScans: previousScans(storeId, extraction, options?.excludeScanId),
  };
}
