"use client";

import { ChevronDown, ChevronUp, FileImage } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

import { InvoiceImageViewer } from "@/modules/invoice-scan/client/components/InvoiceImageViewer";
import { useInvoiceScanImages } from "@/modules/invoice-scan/client/useInvoiceScanImages";
import type { InvoiceScanResponse } from "@/modules/invoice-scan/contracts";
import type { ProductFormInitialValues } from "@/modules/products/product-details/components/ProductFormModal";
import { Button } from "@/shared/components/Button";
import type { EntityFetcher } from "@/shared/components/EntityAutocomplete";
import { ErrorState } from "@/shared/components/ErrorState";
import { LoadingState } from "@/shared/components/LoadingState";
import { Modal } from "@/shared/components/Modal";

import { PurchaseNewProductModal } from "../../components/PurchaseNewProductModal";
import { buildInvoiceReviewDraft, type InvoiceReviewDraft } from "../reviewDraft";
import {
  enterTargetProductId,
  getLineNeeds,
  getReviewSections,
  isPendingStatus,
  nextPendingIndex,
  pressEnter,
  pressEscape,
  reviewReducer,
  type InvoiceReviewAction,
  type InvoiceReviewContext,
  type InvoiceReviewProduct,
  type InvoiceReviewState,
} from "../reviewModel";
import { useInvoiceReview } from "../useInvoiceReview";
import { InvoiceReviewConfirmedNotice } from "./InvoiceReviewConfirmedNotice";
import { InvoiceReviewFooter } from "./InvoiceReviewFooter";
import { InvoiceReviewHeader } from "./InvoiceReviewHeader";
import { InvoiceReviewLineRow } from "./InvoiceReviewLineRow";
import { InvoiceReviewRateNotice } from "./InvoiceReviewRateNotice";
import { InvoiceReviewTaxNotice } from "./InvoiceReviewTaxNotice";
import {
  buildNewProductInitialValues,
  buildReviewTaxRates,
  confirmedToggleLabel,
  getChoiceChips,
} from "./invoiceReviewView";

export type InvoiceReviewPanelProps = {
  /** Respuesta de `POST /api/purchases/invoice-scan`. Otro escaneo = montar de nuevo (`key`). */
  response: InvoiceScanResponse;
  context: InvoiceReviewContext;
  /** "Cargar en la compra": solo se llama con `canLoad` (el borrador nunca es `null`). */
  onLoad: (draft: InvoiceReviewDraft) => void;
  /** "Descartar escaneo". */
  onDiscard: () => void;
  /** "Repetir foto" desde los avisos de la lectura. */
  onRescan: () => void;
  /** Permiso `products.manage`: ofrece "Nuevo producto" en las líneas sin producto. */
  canCreateProduct?: boolean;
  /** Búsqueda de productos; por defecto `GET /api/products` (la del buscador de la compra). */
  productFetcher?: EntityFetcher<"product">;
  /** Búsqueda de proveedores; por defecto `GET /api/purchases/suppliers`. */
  supplierFetcher?: EntityFetcher<"contact">;
};

/**
 * Destino del foco tras una acción de teclado; `seq` fuerza el efecto aunque se
 * repita. `need`: campo que le falta a la línea (con producto) para resolverse.
 */
type FocusRequest = { target: number | null; need?: string; seq: number };

const NEED_FOCUS_ORDER = ["unitsPerPack", "quantity", "unitPrice"] as const;

function InvoiceScanImages({ scanId }: { scanId: string }) {
  const images = useInvoiceScanImages(scanId);

  if (images.isLoading) {
    return <LoadingState title="Cargando la factura..." />;
  }
  if (images.error) {
    return (
      <ErrorState
        description={images.error.message}
        onRetry={() => void images.refetch()}
        title="No se pudo cargar la imagen de la factura"
      />
    );
  }
  return <InvoiceImageViewer alt="Factura escaneada" urls={images.urls} />;
}

/**
 * SCN-08b · Pantalla de revisión del escaneo DENTRO de `/purchases/create` (la
 * página la muestra en lugar del formulario mientras se revisa). Toda la regla
 * es de `reviewModel.ts`: aquí solo se pinta y se despachan acciones.
 *
 * Teclado (6.17): `Enter` sobre una línea pendiente acepta el candidato marcado y
 * pasa el foco a la siguiente pendiente; `Tab` abre su buscador; `Esc` la deja sin
 * emparejar; las flechas marcan otro candidato. Las confirmadas no entran en el recorrido.
 */
export function InvoiceReviewPanel({
  canCreateProduct = false,
  context,
  onDiscard,
  onLoad,
  onRescan,
  productFetcher,
  response,
  supplierFetcher,
}: InvoiceReviewPanelProps) {
  const { dispatch, state, summary } = useInvoiceReview(response, context);
  const [searchIndex, setSearchIndex] = useState<number | null>(null);
  const [confirmedOpen, setConfirmedOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [newProduct, setNewProduct] = useState<{ index: number; values: ProductFormInitialValues } | null>(null);
  // Al abrir la revisión el foco va a la primera pendiente: se puede resolver sin ratón.
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(() => {
    const first = nextPendingIndex(state, null);
    return first === null ? null : { seq: 0, target: first };
  });
  const rowRefs = useRef(new Map<number, HTMLLIElement>());
  const footerRef = useRef<HTMLElement>(null);
  const newProductOpenerRef = useRef<HTMLElement | null>(null);
  const taxRates = useMemo(() => buildReviewTaxRates(state.taxRates), [state.taxRates]);
  const sections = getReviewSections(state);
  // Una confirmada cuyo cantidad × costo no cuadra sigue colapsada (el orden es del
  // modelo), pero el botón lo dice para que se abra a revisarla.
  const confirmedMismatches = sections.confirmed.filter((line) =>
    summary.totals.lineMismatches.includes(line.index),
  ).length;

  /** Pide el foco para `target` según el estado que resultará de la acción (`next`). */
  function requestFocus(target: number | null, next: InvoiceReviewState) {
    const line = target === null ? undefined : next.lines[target];
    // Con el producto ya aceptado pero sin poder resolverse (falta el tamaño del empaque,
    // la cantidad…) el foco va al campo que falta. Sin aceptar, a la fila: Enter acepta primero.
    const needs = line?.productId && line.accepted ? getLineNeeds(line) : [];
    const need = NEED_FOCUS_ORDER.find((item) => needs.includes(item));
    setFocusRequest((current) => ({ seq: (current?.seq ?? 0) + 1, target, ...(need ? { need } : {}) }));
  }

  useEffect(() => {
    if (!focusRequest) {
      return;
    }
    if (focusRequest.target === null) {
      footerRef.current?.querySelector<HTMLButtonElement>("[data-load-button]:not(:disabled)")?.focus();
      return;
    }
    const row = rowRefs.current.get(focusRequest.target);
    if (!row) {
      return;
    }
    const field = focusRequest.need
      ? row.querySelector<HTMLInputElement>(`[data-need="${focusRequest.need}"]`)
      : null;
    (field ?? row).focus();
  }, [focusRequest]);

  /** Aplica la acción y mueve el foco: a la misma línea si sigue pendiente, si no a la siguiente. */
  function applyAndAdvance(action: InvoiceReviewAction & { index: number }) {
    const next = reviewReducer(state, action);
    dispatch(action);
    const line = next.lines[action.index];
    requestFocus(line && isPendingStatus(line.status) ? action.index : nextPendingIndex(next, action.index), next);
  }

  function handleRowKeyDown(event: KeyboardEvent<HTMLLIElement>, index: number) {
    const onRow = event.target === event.currentTarget;
    if (!onRow) {
      // Esc dentro del buscador abierto (con su lista ya cerrada): cierra el buscador.
      if (event.key === "Escape" && searchIndex === index) {
        event.preventDefault();
        setSearchIndex(null);
        requestFocus(index, state);
      }
      // Enter en un campo que la línea pide (unidades, cantidad, costo): como Enter en la
      // fila, acepta el marcado si hace falta y salta a la siguiente pendiente.
      if (
        event.key === "Enter" &&
        event.target instanceof HTMLElement &&
        event.target.hasAttribute("data-need")
      ) {
        const current = state.lines[index];
        if (current && isPendingStatus(current.status) && !current.accepted) {
          const result = pressEnter(state, index);
          dispatch({ type: "acceptMarked", index });
          requestFocus(result.next, result.state);
        } else if (current && !isPendingStatus(current.status)) {
          requestFocus(nextPendingIndex(state, index), state);
        }
      }
      return;
    }
    const line = state.lines[index];
    switch (event.key) {
      case "Enter": {
        event.preventDefault();
        const result = pressEnter(state, index);
        dispatch({ type: "acceptMarked", index });
        if (result.next !== index) {
          setSearchIndex(null);
        }
        requestFocus(result.next, result.state);
        return;
      }
      case "Escape": {
        event.preventDefault();
        const result = pressEscape(state, index);
        dispatch({ type: "leaveUnmatched", index });
        setSearchIndex(null);
        requestFocus(result.next, result.state);
        return;
      }
      case "Tab": {
        if (event.shiftKey) {
          return;
        }
        event.preventDefault();
        if (searchIndex === index) {
          event.currentTarget.querySelector<HTMLInputElement>('input[role="combobox"]')?.focus();
        } else {
          setSearchIndex(index);
        }
        return;
      }
      case "ArrowDown":
      case "ArrowRight":
      case "ArrowUp":
      case "ArrowLeft": {
        const chips = line ? getChoiceChips(line) : [];
        if (!line || chips.length === 0) {
          return;
        }
        event.preventDefault();
        const step = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
        const marked = enterTargetProductId(line);
        const position = Math.max(
          chips.findIndex((chip) => chip.productId === marked),
          0,
        );
        const target = chips[(position + step + chips.length) % chips.length];
        dispatch({ type: "markCandidate", index, productId: target.productId });
        return;
      }
      default:
    }
  }

  function handlePickProduct(index: number, product: InvoiceReviewProduct) {
    setSearchIndex(null);
    applyAndAdvance({ type: "chooseProduct", index, product });
  }

  function handleNewProduct(index: number, opener: HTMLElement) {
    const line = state.lines[index];
    if (!line) {
      return;
    }
    newProductOpenerRef.current = opener;
    setNewProduct({ index, values: buildNewProductInitialValues(state, line) });
  }

  function handleLoad() {
    const draft = buildInvoiceReviewDraft(state);
    if (draft) {
      onLoad(draft);
    }
  }

  function renderRow(index: number) {
    const line = state.lines[index];
    return (
      <InvoiceReviewLineRow
        canCreateProduct={canCreateProduct}
        key={line.index}
        line={line}
        mismatch={summary.totals.lineMismatches.includes(line.index)}
        onAcceptAndAdvance={(action) => {
          if ("index" in action) {
            applyAndAdvance(action);
          }
        }}
        onAction={dispatch}
        onNewProduct={handleNewProduct}
        onOpenSearch={(target) => setSearchIndex((current) => (current === target ? null : target))}
        onPickProduct={handlePickProduct}
        onRowKeyDown={handleRowKeyDown}
        productFetcher={productFetcher}
        rowRef={(element) => {
          if (element) {
            rowRefs.current.set(line.index, element);
          } else {
            rowRefs.current.delete(line.index);
          }
        }}
        searchOpen={searchIndex === line.index}
        state={state}
        taxRates={taxRates}
      />
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="invoice-review-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Revisión de la factura</h2>
          <p className="text-sm text-on-surface-variant">
            Confirma cada línea antes de cargarla en la compra. Nada se enlaza sin tu confirmación.
          </p>
        </div>
        <Button className="lg:hidden" onClick={() => setViewerOpen(true)} variant="outline">
          <FileImage aria-hidden className="size-4" />
          Ver factura
        </Button>
      </div>

      <InvoiceReviewConfirmedNotice state={state} />

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <InvoiceReviewHeader
            onAction={dispatch}
            onRescan={onRescan}
            state={state}
            supplierFetcher={supplierFetcher}
          />
          <InvoiceReviewRateNotice onAction={dispatch} state={state} />
          <InvoiceReviewTaxNotice onAction={dispatch} state={state} />

          <section
            aria-label="Líneas de la factura"
            className="overflow-hidden rounded-xl border border-border bg-surface-container-lowest dark:border-slate-800"
          >
            {state.lines.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-on-surface-variant" role="status">
                No se leyó ninguna línea en la factura. Repite la foto o registra la compra a mano.
              </p>
            ) : null}
            {sections.review.length > 0 ? (
              <ul aria-label="Líneas por revisar" className="divide-y divide-border dark:divide-slate-800">
                {sections.review.map((line) => renderRow(line.index))}
              </ul>
            ) : state.lines.length > 0 && !state.confirmedPurchase ? (
              <p className="px-4 py-4 text-sm text-emerald-700 dark:text-emerald-300" role="status">
                Todas las líneas quedaron emparejadas con tus productos. Revisa los totales y carga la compra.
              </p>
            ) : null}
            {sections.confirmed.length > 0 ? (
              <div className="border-t border-border dark:border-slate-800">
                <button
                  aria-expanded={confirmedOpen}
                  className="flex w-full cursor-pointer items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium text-foreground transition-colors hover:bg-surface-container-low focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  onClick={() => setConfirmedOpen((open) => !open)}
                  type="button"
                >
                  <span>
                    {confirmedToggleLabel(sections.confirmed.length, confirmedOpen)}
                    {confirmedMismatches > 0 ? (
                      <span className="ml-2 text-xs font-normal text-red-700 dark:text-red-300">
                        {confirmedMismatches === 1
                          ? "1 con total distinto al leído"
                          : `${confirmedMismatches} con total distinto al leído`}
                      </span>
                    ) : null}
                  </span>
                  {confirmedOpen ? (
                    <ChevronUp aria-hidden className="size-4" />
                  ) : (
                    <ChevronDown aria-hidden className="size-4" />
                  )}
                </button>
                {confirmedOpen ? (
                  <ul aria-label="Líneas confirmadas" className="divide-y divide-border border-t border-border dark:divide-slate-800 dark:border-slate-800">
                    {sections.confirmed.map((line) => renderRow(line.index))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </section>
        </div>

        <aside aria-label="Factura escaneada" className="hidden lg:block">
          <div className="sticky top-4 rounded-xl border border-border bg-surface-container-lowest p-3 dark:border-slate-800">
            <InvoiceScanImages scanId={state.scanId} />
          </div>
        </aside>
      </div>

      <InvoiceReviewFooter
        footerRef={footerRef}
        onDiscard={onDiscard}
        onLoad={handleLoad}
        state={state}
        summary={summary}
      />

      <Modal onOpenChange={setViewerOpen} open={viewerOpen} title="Factura escaneada">
        {viewerOpen ? <InvoiceScanImages scanId={state.scanId} /> : null}
      </Modal>

      {canCreateProduct ? (
        <PurchaseNewProductModal
          initialValues={newProduct?.values}
          onCreated={(product) => {
            const index = newProduct?.index;
            setNewProduct(null);
            if (index !== undefined) {
              applyAndAdvance({ type: "chooseProduct", index, product: { productId: product.id, name: product.name } });
            }
          }}
          onOpenChange={(open) => {
            if (!open) {
              setNewProduct(null);
            }
          }}
          open={newProduct !== null}
          returnFocusTo={newProductOpenerRef}
        />
      ) : null}
    </div>
  );
}
