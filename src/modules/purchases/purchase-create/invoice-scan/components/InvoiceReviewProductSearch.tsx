"use client";

import { useEffect, useMemo, useRef } from "react";

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
    sku: "",
  };
}

/**
 * Pone `text` en el campo como si se hubiera tecleado: `EntityAutocomplete` no
 * acepta un texto inicial y su estado se alimenta del evento `input` de React.
 * Queda seleccionado: lo que el usuario teclee lo reemplaza.
 */
function typeInitialText(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.select();
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
  const containerRef = useRef<HTMLDivElement>(null);
  const reasons = useMemo(
    () => new Map(candidates.map((candidate) => [candidate.productId, candidate])),
    [candidates],
  );
  const readQuery = initialQuery.trim();

  const withCandidates = useMemo<EntityFetcher<"product">>(
    () => async (params) => {
      const found = await fetcher(params);
      if (params.query.trim() !== readQuery || candidates.length === 0) {
        return found;
      }
      return [
        ...candidates.map(candidateOption),
        ...found.filter((option) => !reasons.has(option.id)),
      ];
    },
    [candidates, fetcher, readQuery, reasons],
  );

  useEffect(() => {
    const input = containerRef.current?.querySelector<HTMLInputElement>("input");
    if (input && readQuery) {
      typeInitialText(input, readQuery);
    }
    // Solo al abrir: después el texto es del usuario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={containerRef}>
      <EntityAutocomplete
        autoFocus
        entity="product"
        fetcher={withCandidates}
        filters={PRODUCT_FILTERS}
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
            return `Sugerido · ${candidate.reason} · ${formatScore(candidate.score)}`;
          }
          return [option.sku, `Stock ${option.currentStock}`].filter(Boolean).join(" · ");
        }}
        value={null}
      />
    </div>
  );
}
