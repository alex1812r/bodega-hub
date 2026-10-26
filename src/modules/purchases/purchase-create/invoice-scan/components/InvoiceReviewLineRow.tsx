"use client";

import { AlertTriangle, Check, Plus, RotateCcw, Search, Trash2 } from "lucide-react";
import { type CSSProperties, type KeyboardEvent, type Ref, useId } from "react";

import { Badge } from "@/shared/components/Badge/Badge";
import { Button } from "@/shared/components/Button";
import type { EntityFetcher } from "@/shared/components/EntityAutocomplete";
import { NumberInput } from "@/shared/components/NumberInput";
import { TaxRateChips } from "@/shared/components/TaxRateChips";
import type { TaxRate } from "@/shared/hooks/useTaxRates";
import { cn } from "@/shared/utils/cn";

import {
  enterTargetProductId,
  getEntryModeOutcome,
  getLineAmount,
  getLineCostReview,
  getLineLastCost,
  getTaxInclusion,
  getUnitConversion,
  isPendingStatus,
  lineOffersPack,
  linePackWord,
  MAX_REVIEW_QUANTITY,
  needsExplicitChoice,
  type InvoiceReviewAction,
  type InvoiceReviewLine,
  type InvoiceReviewProduct,
  type InvoiceReviewState,
} from "../reviewModel";
import { InvoiceReviewProductSearch } from "./InvoiceReviewProductSearch";
import {
  costAcknowledgementTexts,
  ENTRY_MODE_DEVIATION_TEXT,
  entryModeOutcomeText,
  formatInvoiceMoney,
  getChoiceChips,
  getDisplayedLineIssues,
  lineNeedMessages,
  REVIEW_STATUS_META,
} from "./invoiceReviewView";

const ARROW_KEYS = new Set(["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"]);

export type InvoiceReviewLineRowProps = {
  state: InvoiceReviewState;
  line: InvoiceReviewLine;
  /** Cantidad × precio no cuadra con el total leído de la línea. */
  mismatch: boolean;
  taxRates: TaxRate[];
  searchOpen: boolean;
  /** D36: Enter sobre la fila con aviso no elige: resalta los avisos (la opción la elige el usuario). */
  noticeHighlighted?: boolean;
  canCreateProduct: boolean;
  productFetcher?: EntityFetcher<"product">;
  rowRef?: Ref<HTMLLIElement>;
  /** D46-a: clave de caja de la fila (`data-layout-box`) y su alto mínimo con el layout pendiente. */
  layoutBox?: string;
  layoutStyle?: CSSProperties;
  onAction: (action: InvoiceReviewAction) => void;
  /** Elegir candidato con Enter (teclado); D39-6: el foco queda en la fila. */
  onAcceptByKey: (action: InvoiceReviewAction) => void;
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
  layoutBox,
  layoutStyle,
  line,
  mismatch,
  noticeHighlighted = false,
  onAcceptByKey,
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
  const fractional = Number.isFinite(line.quantity) && line.quantity > 0 && !Number.isInteger(line.quantity);
  // D54-b (C12B-M2): ofrecida una vez, «Por empaque» no desaparece al elegir «Por unidad».
  const showPack = lineOffersPack(state, line);
  // D42: el costo de ESE producto con su modo frente a su último costo. Desviado o sin poder
  // comparar, se elige la opción y se reconoce aparte (D43): aunque solo tenga un modo, se muestra.
  const costReview = getLineCostReview(state, line);
  const lastCost = getLineLastCost(state, line);
  const costUnconfirmed =
    costReview.kind === "loading" || (costReview.kind === "acknowledge" && !costReview.acknowledged);
  const showOptions = showPack || costReview.kind !== "clear";
  // D33-a (C6-M1): con aviso (o costo por reconocer) y sin elección, ninguna opción viene marcada.
  // D43: elegida la opción, queda marcada aunque falte reconocer su costo (botón aparte).
  const checkedMode =
    needsExplicitChoice(line) || (costUnconfirmed && !line.choiceMade) ? undefined : line.entryMode;
  // D43 (B-r9-1): reconocer el costo es un paso aparte que solo aparece tras elegir la opción.
  const costAck =
    costReview.kind === "acknowledge" && line.choiceMade ? costAcknowledgementTexts(state, line) : undefined;
  const conversion = fractional ? getUnitConversion(line) : undefined;
  const taxLabel = getTaxInclusion(state).included ? "con IVA" : "sin IVA";
  // D43 (B-r9-1): la resuelta conserva sus candidatos (el elegido, marcado). Si desaparecieran al
  // resolverse, la fila subiría y otro control de decisión quedaría bajo el dedo que la resolvió.
  const showChips = pending || line.status === "resolved";
  const marked = showChips ? enterTargetProductId(line) : undefined;
  const chips = showChips ? getChoiceChips(line) : [];
  const currencyLabel = state.usd.anomaly ? "USD" : "Bs";
  const issues = getDisplayedLineIssues(state, line);
  const needs = line.discarded ? [] : lineNeedMessages(state, line);
  const amount = getLineAmount(line);
  const noticesId = useId();
  const optionsId = useId();
  const hasNotices = issues.length > 0 || needs.length > 0;
  // D48(b) (B-p11-1): con el layout pendiente, la descartada o resuelta conserva su caja; el sitio
  // que deja libre lo ocupa un resumen (texto, nunca un control) en vez de un hueco en blanco.
  const heldSummary =
    layoutStyle === undefined
      ? undefined
      : line.discarded
        ? "Línea descartada · Restaurar la devuelve a la compra"
        : line.status === "resolved"
          ? `Resuelta: ${title} · ${formatInvoiceMoney(state, amount)}`
          : undefined;

  return (
    <li
      aria-describedby={hasNotices ? noticesId : undefined}
      aria-label={`Línea ${index + 1}: ${line.description || line.rawText}`}
      className={cn(
        "flex flex-col gap-3 border-l-4 bg-surface-container-lowest px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        meta.borderClassName,
        line.discarded ? "opacity-70" : null,
      )}
      data-layout-box={layoutBox}
      data-line-index={index}
      data-status={line.status}
      onKeyDown={(event) => onRowKeyDown(event, index)}
      ref={rowRef}
      role="group"
      style={layoutStyle}
      // D31: la descartada recibe el foco (no «Restaurar») si no queda otra pendiente. D39-6: la
      // resuelta también, al elegir su opción (el foco no avanza solo a otra fila).
      tabIndex={pending ? 0 : line.status === "confirmed_by_match" ? undefined : -1}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={meta.tone}>{meta.label}</Badge>
            <span className={cn("text-sm font-medium text-foreground", line.discarded ? "line-through" : null)}>
              {title}
            </span>
          </div>
          <p className="mt-1 break-words text-xs text-on-surface-variant" title={line.rawText}>
            {line.rawText || line.description}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 text-right text-sm tabular-nums">
          <span className={cn("font-medium", mismatch ? "text-red-700 dark:text-red-300" : "text-foreground")}>
            {formatInvoiceMoney(state, amount)}
          </span>
          {/* D46: bajo el importe, donde ni la fila pendiente ni la restaurada tienen controles (en el
              sitio de los candidatos, el 2.º toque de «Restaurar» aceptaría uno). */}
          {line.discarded ? (
            <Button
              data-row-action="restore"
              onClick={() => onAction({ type: "restoreLine", index })}
              size="sm"
              variant="outline"
            >
              <RotateCcw aria-hidden className="size-4" />
              Restaurar
            </Button>
          ) : null}
          {/* B-qa23-2 (D60(c)): aparece al teclear; si baja lo que le sigue, useLayoutHold lo guarda. */}
          <div className="empty:hidden" data-layout-notice>
            {mismatch ? (
              <p className="text-xs text-red-700 dark:text-red-300" data-testid={`line-mismatch-${index}`}>
                La factura dice {formatInvoiceMoney(state, line.lineTotalRead)}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {line.discarded ? null : (
        <>
          {chips.length > 0 ? (
            <div aria-label="Candidatos" className="flex flex-wrap gap-2" role="group">
              {chips.map((candidate) => {
                // B-p12-1: pulsado = el producto de la línea; el que solo aceptaría Enter (sin producto
                // aún) se distingue con el borde discontinuo, no como pulsado.
                const isChosen = candidate.productId === line.productId;
                const isMarked = candidate.productId === marked;
                return (
                  <button
                    aria-pressed={isChosen}
                    className={cn(
                      "flex min-w-0 max-w-full cursor-pointer flex-col items-start rounded-lg border px-3 py-1.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isChosen
                        ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                        : isMarked
                          ? "border-dashed border-indigo-400 bg-surface-container-lowest text-foreground hover:bg-surface-container-low dark:border-indigo-500"
                          : "border-outline-variant bg-surface-container-lowest text-foreground hover:bg-surface-container-low",
                    )}
                    data-candidate
                    data-marked={isMarked || undefined}
                    key={candidate.productId}
                    onClick={() => onAction({ type: "acceptCandidate", index, productId: candidate.productId })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        event.stopPropagation();
                        onAcceptByKey({ type: "acceptCandidate", index, productId: candidate.productId });
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

          {/* D46: el buscador se pinta DEBAJO de las acciones; encima, su lista quedaría bajo el dedo que
              pulsó «Buscar producto» y el 2.º toque elegiría un producto. D48-c (B-p11-2): va también
              después en el documento, para que Tab siga el orden visual (acciones, buscador, campos). */}
          <div className="flex flex-col gap-3">
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
                <Button
                  data-row-action="discard"
                  onClick={() => onAction({ type: "discardLine", index })}
                  size="sm"
                  variant="ghost"
                >
                  <Trash2 aria-hidden className="size-4" />
                  Descartar línea
                </Button>
              ) : line.status === "resolved" ? (
                // D43 (B-r9-1): resuelta, el hueco se conserva (a 390 px la fila de acciones no se pliega
                // y nada sube bajo el dedo); no es un control.
                <span aria-hidden className="invisible inline-flex h-9 items-center gap-2 px-3 text-sm font-medium">
                  <Trash2 className="size-4" />
                  Descartar línea
                </span>
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
          </div>

          {/* REP14-02 (M-p15-2, D63): cantidad, costo e IVA en una fila según el ancho de la línea, no el de la
              pantalla: a 1024 px con el menú lateral y la imagen la línea mide ~290 px y el costo se cortaba. */}
          <div className="@container">
            <div className="grid grid-cols-2 gap-3 @md:grid-cols-[minmax(0,8rem)_minmax(0,10rem)_auto] @md:items-end">
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
                label={`Costo (${currencyLabel}, ${taxLabel})`}
                min={0}
                onValueChange={(value) =>
                  onAction({ type: "editUnitPrice", index, unitPrice: value ?? Number.NaN })
                }
                thousandsHintPlacement="floating"
                value={finiteOrNull(line.unitPrice)}
              />
              <div className="col-span-2 flex flex-col gap-2 @md:col-span-1">
                <span className="text-xs font-medium text-on-surface-variant">IVA</span>
                <TaxRateChips
                  label={`IVA de la línea ${index + 1}`}
                  onChange={(code) => onAction({ type: "editTaxRate", index, taxRateCode: code })}
                  rates={taxRates}
                  value={line.taxRateCode || null}
                />
              </div>
            </div>
          </div>

          {showOptions ? (
            <div className="flex flex-col gap-2 rounded-lg border border-outline-variant p-3">
              <div aria-label="Cómo se compra" className="flex flex-wrap gap-2" role="group">
                {(showPack ? (["unit", "pack"] as const) : (["unit"] as const)).map((mode) => {
                  // B-p7-3 / D42: cada opción dice antes qué entra al stock y a qué costo, con o sin aviso.
                  const outcome = getEntryModeOutcome(state, line, mode);
                  const deviates = outcome?.deviates === true;
                  const unverified = outcome?.lastCost === "error";
                  const optionId = `${optionsId}-${mode}`;
                  return (
                    <button
                      aria-describedby={
                        outcome ? `${optionId}-outcome${deviates ? ` ${optionId}-deviation` : ""}` : undefined
                      }
                      aria-labelledby={`${optionId}-label`}
                      aria-pressed={checkedMode === mode}
                      className={cn(
                        "cursor-pointer border text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        // Con resultado, la opción envuelve el texto (cabe a 390 px).
                        outcome
                          ? "flex min-h-8 max-w-full flex-col items-start gap-0.5 rounded-lg px-3 py-1.5 text-left break-words whitespace-normal"
                          : "h-8 rounded-full px-3",
                        checkedMode === mode
                          ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                          : "border-outline-variant text-foreground hover:bg-surface-container-low",
                        deviates || unverified ? "border-amber-400 dark:border-amber-500" : null,
                        (deviates || unverified) && checkedMode !== mode ? "bg-amber-50 dark:bg-amber-950" : null,
                      )}
                      data-choice={mode}
                      data-deviates={deviates || undefined}
                      key={mode}
                      onClick={() => onAction({ type: "editEntryMode", index, entryMode: mode })}
                      onKeyDown={(event) => {
                        if (!ARROW_KEYS.has(event.key)) {
                          return;
                        }
                        event.preventDefault();
                        if (event.repeat) {
                          return;
                        }
                        // D39-5: botones de acción, no radios; cualquier flecha lleva el foco a la otra
                        // opción sin elegirla (eligen Enter, Espacio o clic).
                        const other = mode === "unit" ? "pack" : "unit";
                        event.currentTarget.parentElement
                          ?.querySelector<HTMLElement>(`[data-choice="${other}"]`)
                          ?.focus();
                      }}
                      type="button"
                    >
                      <span id={`${optionId}-label`}>{mode === "unit" ? "Por unidad" : `Por ${linePackWord(line)}`}</span>
                      {outcome ? (
                        <span className="font-normal tabular-nums" id={`${optionId}-outcome`}>
                          {entryModeOutcomeText(line, outcome)}
                        </span>
                      ) : null}
                      {deviates ? (
                        <span
                          className="flex items-start gap-1 font-normal text-amber-700 dark:text-amber-300"
                          id={`${optionId}-deviation`}
                        >
                          <AlertTriangle aria-hidden className="mt-0.5 size-3 shrink-0" />
                          {ENTRY_MODE_DEVIATION_TEXT}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              {/* D43 (B-r9-1): debajo de las opciones (nunca en el sitio del control recién pulsado);
                  reconocido, lo sustituye un texto del mismo tamaño para que nada se mueva. */}
              {costAck && costReview.kind === "acknowledge" && !costReview.acknowledged ? (
                <button
                  className="flex min-h-8 max-w-full cursor-pointer items-center gap-1 self-start rounded-lg border border-amber-400 bg-amber-50 px-3 py-1.5 text-left text-xs font-medium break-words whitespace-normal text-amber-800 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-amber-500 dark:bg-amber-950 dark:text-amber-200 dark:hover:bg-amber-900"
                  data-cost-ack
                  onClick={() => onAction({ type: "acknowledgeCost", index })}
                  type="button"
                >
                  <AlertTriangle aria-hidden className="size-3 shrink-0" />
                  {costAck.ask}
                </button>
              ) : costAck ? (
                <p
                  className="flex min-h-8 max-w-full items-center gap-1 self-start rounded-lg border border-transparent px-3 py-1.5 text-xs font-medium break-words text-on-surface-variant"
                  data-testid="invoice-review-cost-acknowledged"
                >
                  <Check aria-hidden className="size-3 shrink-0" />
                  {costAck.done}
                </p>
              ) : null}
              {line.entryMode === "pack" ? (
                // Sin `min` y con signo (SCN-UI-C1, 6.19): un 0 o un negativo tecleado no se
                // corrige solo; la línea queda sin resolver y lo dice.
                <NumberInput
                  allowNegative
                  className="max-w-40"
                  data-need="unitsPerPack"
                  decimals={0}
                  label={`Unidades por ${line.packLabel.toLowerCase()}`}
                  onValueChange={(value) =>
                    onAction({ type: "editUnitsPerPack", index, unitsPerPack: value ?? undefined })
                  }
                  required
                  thousandsHint={false}
                  value={line.unitsPerPack ?? null}
                />
              ) : null}
            </div>
          ) : lastCost?.status === "none" ? (
            // D42: sin opciones a la vista, la fila dice que no hay con qué comparar el costo.
            <p className="text-xs text-on-surface-variant" data-testid="invoice-review-no-last-cost">
              Sin costo previo de este producto.
            </p>
          ) : null}

          {conversion?.ok && !line.discarded ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-on-surface-variant">
              <Button
                onClick={() => onAction({ type: "convertPackToUnits", index })}
                size="sm"
                variant="outline"
              >
                {`Cargar como ${conversion.units} unidades`}
              </Button>
              <span>
                {`La compra solo admite cantidades enteras: ${conversion.units} unidades a ${formatInvoiceMoney(state, conversion.unitPrice)} cada una.`}
              </span>
            </div>
          ) : null}

          {hasNotices ? (
            <ul
              className={cn(
                "flex flex-col gap-1 text-xs",
                noticeHighlighted
                  ? "rounded-md bg-amber-50 p-2 ring-2 ring-amber-400 dark:bg-amber-950 dark:ring-amber-500"
                  : null,
              )}
              data-highlighted={noticeHighlighted || undefined}
              data-testid="invoice-review-line-notices"
              id={noticesId}
            >
              {issues.map((issue) => (
                <li className="flex items-start gap-1.5 text-amber-700 dark:text-amber-300" key={`issue-${issue.key}`}>
                  <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                  {issue.text}
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

      {heldSummary ? (
        // Solo el alto sobrante de la caja retenida (`basis-0`, y `-mt-3` anula el `gap`): nunca
        // empuja nada. Sin padding propio (con `border-box` no baja de él: la fila crecería); la
        // separación es el `mt-3` del texto, dentro del alto recortado. En la descartada queda justo
        // bajo el encabezado, en la parte alta de la caja.
        <div
          className="-mt-3 flex min-h-0 flex-1 basis-0 flex-col overflow-hidden"
          data-testid="invoice-review-held-summary"
        >
          <p
            className={cn(
              "mt-3 text-xs text-on-surface-variant",
              line.discarded ? "flex-1 rounded-lg border border-dashed border-outline-variant px-3 py-2" : null,
            )}
          >
            {heldSummary}
          </p>
        </div>
      ) : null}
    </li>
  );
}
