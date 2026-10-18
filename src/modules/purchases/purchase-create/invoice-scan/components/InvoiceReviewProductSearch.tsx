"use client";

import { useMemo } from "react";

import type { InvoiceMatchCandidate } from "@/modules/invoice-scan/contracts";
import {
  EntityAutocomplete,
  type EntityFetcher,
  fetchProductEntityOptions,
  type ProductEntityFilters,
  type ProductEntityOption,
} from "@/shared/components/EntityAutocomplete";

import type { InvoiceReviewProduct } from "../reviewModel";
import { formatScore } from "./invoiceReviewView";
import { searchByReadText } from "./readTextSearch";

const PRODUCT_FILTERS: ProductEntityFilters = { active: true };

export type InvoiceReviewProductSearchProps = {
  /** Texto leído de la factura: es la búsqueda con la que se abre. */
  initialQuery: string;
  /** ≤ 3 candidatos del emparejamiento: van arriba mientras la búsqueda sea la leída. */
  candidates: InvoiceMatchCandidate[];
  fetcher?: EntityFetcher<"product">;
  label: string;
  onPick: (product: InvoiceReviewProduct) => void;
};

function candidateOption(candidate: InvoiceMatchCandidate): ProductEntityOption {
  return {
    barcode: null,
    categoryId: "",
    currentCostRef: 0,
    currentStock: 0,
    id: candidate.productId,
    isActive: true,
    label: candidate.name,
    salePriceRef: 0,
    sku: candidate.sku ?? "",
  };
}

/**
 * Buscador de producto de una línea de la factura (SCN-08): `EntityAutocomplete`
 * que se abre ya con la descripción leída como búsqueda y con los candidatos del
 * emparejamiento primero, para que el usuario confirme en vez de teclear.
 */
export function InvoiceReviewProductSearch({
  candidates,
  fetcher = fetchProductEntityOptions,
  initialQuery,
  label,
  onPick,
}: InvoiceReviewProductSearchProps) {
  const reasons = useMemo(
    () => new Map(candidates.map((candidate) => [candidate.productId, candidate])),
    [candidates],
  );
  const readQuery = initialQuery.trim();

  const withCandidates = useMemo<EntityFetcher<"product">>(
    () => async (params) => {
      if (params.query.trim() !== readQuery) {
        return fetcher(params);
      }
      const found = await searchByReadText(fetcher, params);
      if (candidates.length === 0) {
        return found;
      }
      return [
        ...candidates.map(candidateOption),
        ...found.filter((option) => !reasons.has(option.id)),
      ];
    },
    [candidates, fetcher, readQuery, reasons],
  );

  return (
    <div>
      <EntityAutocomplete
        autoFocus
        entity="product"
        fetcher={withCandidates}
        filters={PRODUCT_FILTERS}
        initialQuery={readQuery}
        label={label}
        onChange={(option) => {
          if (option) {
            onPick({ productId: option.id, name: option.label });
          }
        }}
        recentsKey={null}
        renderSecondary={(option) => {
          const candidate = reasons.get(option.id);
          if (candidate) {
            // D24-d: el SKU distingue candidatos de igual nombre, como en los chips.
            return `Sugerido · ${candidate.sku ? `SKU ${candidate.sku} · ` : ""}${candidate.reason} · ${formatScore(candidate.score)}`;
          }
          return [option.sku, `Stock ${option.currentStock}`].filter(Boolean).join(" · ");
        }}
        value={null}
      />
    </div>
  );
}
