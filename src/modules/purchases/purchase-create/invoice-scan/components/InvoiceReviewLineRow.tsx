"use client";

import { AlertTriangle, Plus, RotateCcw, Search, Trash2 } from "lucide-react";
import type { KeyboardEvent, Ref } from "react";

import { Badge } from "@/shared/components/Badge/Badge";
import { Button } from "@/shared/components/Button";
import type { EntityFetcher } from "@/shared/components/EntityAutocomplete";
import { NumberInput } from "@/shared/components/NumberInput";
import { TaxRateChips } from "@/shared/components/TaxRateChips";
import type { TaxRate } from "@/shared/hooks/useTaxRates";
import { cn } from "@/shared/utils/cn";

import {
  enterTargetProductId,
  getLineAmount,
  isPendingStatus,
  MAX_REVIEW_QUANTITY,
  type InvoiceReviewAction,
  type InvoiceReviewLine,
  type InvoiceReviewProduct,
  type InvoiceReviewState,
} from "../reviewModel";
import { InvoiceReviewProductSearch } from "./InvoiceReviewProductSearch";
import {
  formatInvoiceMoney,
  getChoiceChips,
  lineNeedMessages,
  REVIEW_STATUS_META,
} from "./invoiceReviewView";

const PACK_UNITS = new Set(["caja", "bulto", "paquete", "display"]);

export type InvoiceReviewLineRowProps = {
  state: InvoiceReviewState;
  line: InvoiceReviewLine;
  /** Cantidad × precio no cuadra con el total leído de la línea. */
  mismatch: boolean;
  taxRates: TaxRate[];
  searchOpen: boolean;
  canCreateProduct: boolean;
  productFetcher?: EntityFetcher<"product">;
  rowRef?: Ref<HTMLLIElement>;
  onAction: (action: InvoiceReviewAction) => void;
  /** Elegir candidato o producto y saltar a la siguiente pendiente (teclado). */
  onAcceptAndAdvance: (action: InvoiceReviewAction) => void;
  onRowKeyDown: (event: KeyboardEvent<HTMLLIElement>, index: number) => void;
  onOpenSearch: (index: number) => void;
  onPickProduct: (index: number, product: InvoiceReviewProduct) => void;
  onNewProduct: (index: number, opener: HTMLElement) => void;
};

function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

/**
 * Una línea de la factura en la revisión: estado por color, producto con el
 * texto leído debajo, candidatos con su motivo, buscador, cantidad, costo,
 * alícuota y empaque. Las pendientes reciben foco (recorrido con teclado).
 */
export function InvoiceReviewLineRow({
  canCreateProduct,
  line,
  mismatch,
  onAcceptAndAdvance,
  onAction,
  onNewProduct,
  onOpenSearch,
  onPickProduct,
  onRowKeyDown,
  productFetcher,
  rowRef,
  searchOpen,
  state,
  taxRates,
}: InvoiceReviewLineRowProps) {
  const meta = REVIEW_STATUS_META[line.status];
  const pending = isPendingStatus(line.status);
  const index = line.index;
  const title = line.productName || (line.productId ? "Producto elegido" : "Sin producto");
  const readUnit = state.extraction.lines[index]?.unit;
  const showPack = line.entryMode === "pack" || (readUnit !== undefined && PACK_UNITS.has(readUnit));
  const marked = pending ? enterTargetProductId(line) : undefined;
  const chips = pending ? getChoiceChips(line) : [];
  const currencyLabel = state.usd.anomaly ? "USD" : "Bs";
  const needs = line.discarded ? [] : lineNeedMessages(line);
  const amount = getLineAmount(line);

  return (
    <li
      aria-label={`Línea ${index + 1}: ${line.description || line.rawText}`}
      className={cn(
        "flex flex-col gap-3 border-l-4 bg-surface-container-lowest px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        meta.borderClassName,
        line.discarded ? "opacity-70" : null,
      )}
      data-line-index={index}
      data-status={line.status}
      onKeyDown={(event) => onRowKeyDown(event, index)}
      ref={rowRef}
      role="group"
      tabIndex={pending ? 0 : undefined}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={meta.tone}>{meta.label}</Badge>
            <span className={cn("text-sm font-medium text-foreground", line.discarded ? "line-through" : null)}>
              {title}
            </span>
          </div>
          <p className="mt-1 truncate text-xs text-on-surface-variant" title={line.rawText}>
            {line.rawText || line.description}
          </p>
        </div>
        <div className="text-right text-sm tabular-nums">
          <span className={cn("font-medium", mismatch ? "text-red-700 dark:text-red-300" : "text-foreground")}>
            {formatInvoiceMoney(state, amount)}
          </span>
          {mismatch ? (
            <p className="text-xs text-red-700 dark:text-red-300" data-testid={`line-mismatch-${index}`}>
              La factura dice {formatInvoiceMoney(state, line.lineTotalRead)}
            </p>
          ) : null}
        </div>
      </div>

      {line.discarded ? (
        <div>
          <Button onClick={() => onAction({ type: "restoreLine", index })} size="sm" variant="outline">
            <RotateCcw aria-hidden className="size-4" />
            Restaurar
          </Button>
        </div>
      ) : (
        <>
          {chips.length > 0 ? (
            <div aria-label="Candidatos" className="flex flex-wrap gap-2" role="group">
              {chips.map((candidate) => {
                const isMarked = candidate.productId === marked;
                return (
                  <button
                    aria-pressed={isMarked}
                    className={cn(
                      "flex min-w-0 max-w-full cursor-pointer flex-col items-start rounded-lg border px-3 py-1.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isMarked
                        ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                        : "border-outline-variant bg-surface-container-lowest text-foreground hover:bg-surface-container-low",
                    )}
                    key={candidate.productId}
                    onClick={() => onAction({ type: "acceptCandidate", index, productId: candidate.productId })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        event.stopPropagation();
                        onAcceptAndAdvance({ type: "acceptCandidate", index, productId: candidate.productId });
                      }
                    }}
                    type="button"
                  >
                    <span className="max-w-full truncate text-sm font-medium">{candidate.name}</span>
                    <span className="text-on-surface-variant">{candidate.detail}</span>
                  </button>
                );
              })}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => onOpenSearch(index)} size="sm" variant="outline">
              <Search aria-hidden className="size-4" />
              {line.productId ? "Cambiar producto" : "Buscar producto"}
            </Button>
            {canCreateProduct && !line.productId ? (
              <Button
                onClick={(event) => onNewProduct(index, event.currentTarget)}
                size="sm"
                variant="outline"
              >
                <Plus aria-hidden className="size-4" />
                Nuevo producto
              </Button>
            ) : null}
            {pending ? (
              <Button onClick={() => onAction({ type: "discardLine", index })} size="sm" variant="ghost">
                <Trash2 aria-hidden className="size-4" />
                Descartar línea
              </Button>
            ) : null}
          </div>

          {searchOpen ? (
            <InvoiceReviewProductSearch
              candidates={line.candidates}
              fetcher={productFetcher}
              initialQuery={line.description || line.rawText}
              label={`Producto de la línea ${index + 1}`}
              onPick={(product) => onPickProduct(index, product)}
            />
          ) : null}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-[minmax(0,8rem)_minmax(0,10rem)_auto] sm:items-end">
            <NumberInput
              data-need="quantity"
              decimals={0}
              label={line.entryMode === "pack" ? `Cantidad (${line.packLabel.toLowerCase()})` : "Cantidad"}
              max={MAX_REVIEW_QUANTITY}
              onValueChange={(value) =>
                onAction({ type: "editQuantity", index, quantity: value ?? Number.NaN })
              }
              thousandsHint={false}
              value={finiteOrNull(line.quantity)}
            />
            <NumberInput
              data-need="unitPrice"
              decimals={2}
              label={`Costo (${currencyLabel}, sin IVA)`}
              min={0}
              onValueChange={(value) =>
                onAction({ type: "editUnitPrice", index, unitPrice: value ?? Number.NaN })
              }
              thousandsHintPlacement="floating"
              value={finiteOrNull(line.unitPrice)}
            />
            <div className="col-span-2 flex flex-col gap-2 sm:col-span-1">
              <span className="text-xs font-medium text-on-surface-variant">IVA</span>
              <TaxRateChips
                label={`IVA de la línea ${index + 1}`}
                onChange={(code) => onAction({ type: "editTaxRate", index, taxRateCode: code })}
                rates={taxRates}
                value={line.taxRateCode || null}
              />
            </div>
          </div>

          {showPack ? (
            <div className="flex flex-col gap-2 rounded-lg border border-outline-variant p-3">
              <div aria-label="Cómo se compra" className="flex flex-wrap gap-2" role="radiogroup">
                {(["unit", "pack"] as const).map((mode) => (
                  <button
                    aria-checked={line.entryMode === mode}
                    className={cn(
                      "h-8 cursor-pointer rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      line.entryMode === mode
                        ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                        : "border-outline-variant text-foreground hover:bg-surface-container-low",
                    )}
                    key={mode}
                    onClick={() => onAction({ type: "editEntryMode", index, entryMode: mode })}
                    role="radio"
                    type="button"
                  >
                    {mode === "unit" ? "Por unidad" : `Por ${line.packLabel.toLowerCase()}`}
                  </button>
                ))}
              </div>
              {line.entryMode === "pack" ? (
                <NumberInput
                  className="max-w-40"
                  data-need="unitsPerPack"
                  decimals={0}
                  label={`Unidades por ${line.packLabel.toLowerCase()}`}
                  min={1}
                  onValueChange={(value) =>
                    onAction({ type: "editUnitsPerPack", index, unitsPerPack: value ?? undefined })
                  }
                  required
                  thousandsHint={false}
                  value={line.unitsPerPack ?? null}
                />
              ) : null}
            </div>
          ) : null}

          {line.issues.length > 0 || needs.length > 0 ? (
            <ul className="flex flex-col gap-1 text-xs">
              {line.issues.map((issue) => (
                <li className="flex items-start gap-1.5 text-amber-700 dark:text-amber-300" key={`issue-${issue}`}>
                  <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                  {issue}
                </li>
              ))}
              {needs.map((need) => (
                <li className="flex items-start gap-1.5 text-red-700 dark:text-red-300" key={`need-${need}`}>
                  <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                  {need}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </li>
  );
}
