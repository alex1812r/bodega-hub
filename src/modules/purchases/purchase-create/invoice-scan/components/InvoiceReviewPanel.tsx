"use client";

import { ChevronDown, ChevronUp, FileImage } from "lucide-react";
import { type FocusEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

import { InvoiceImageViewer } from "@/modules/invoice-scan/client/components/InvoiceImageViewer";
import { fetchLastUnitCostRef } from "@/modules/invoice-scan/client/fetchLastUnitCost";
import { buildInvoiceDuplicateQuery } from "@/modules/invoice-scan/client/fetchInvoiceDuplicates";
import { type InvoiceDuplicatesFetcher, useInvoiceDuplicates } from "@/modules/invoice-scan/client/useInvoiceDuplicates";
import { useInvoiceScanImages } from "@/modules/invoice-scan/client/useInvoiceScanImages";
import type { InvoiceScanResponse } from "@/modules/invoice-scan/contracts";
import type { ProductFormInitialValues } from "@/modules/products/product-details/components/ProductFormModal";
import { Button } from "@/shared/components/Button";
import { ConfirmActionModal } from "@/shared/components/ConfirmActionModal";
import type { EntityFetcher } from "@/shared/components/EntityAutocomplete";
import { ErrorState } from "@/shared/components/ErrorState";
import { LoadingState } from "@/shared/components/LoadingState";
import { Modal } from "@/shared/components/Modal";

import { PurchaseNewProductModal } from "../../components/PurchaseNewProductModal";
import { buildInvoiceReviewDraft, type InvoiceReviewDraft } from "../reviewDraft";
import {
  awaitsCostAcknowledgement,
  enterTargetProductId,
  getLineNeeds,
  getReviewSections,
  isPendingStatus,
  needsOptionChoice,
  nextPendingIndex,
  pressEnter,
  pressEscape,
  reviewReducer,
  type InvoiceReviewAction,
  type InvoiceReviewContext,
  type InvoiceReviewProduct,
  type InvoiceReviewSections,
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
  lineNeedMessages,
} from "./invoiceReviewView";
import {
  isSpatialRebound,
  POINTER_GUARD_RADIUS_PX,
  type PointerActivation,
  readPointerActivation,
  REVEAL_GUARD_MS,
  useLayoutHold,
} from "./useLayoutHold";

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
  /**
   * D42: último costo unitario (REF) de un producto elegido en el buscador; por defecto
   * `fetchLastUnitCostRef` (`GET /api/purchases/invoice-scan/last-unit-costs`, solo ids).
   */
  lastUnitCostFetcher?: (productId: string, supplierId?: string) => Promise<number | null>;
  /**
   * REP12-01 (D52): duplicados con el proveedor elegido; por defecto
   * `POST /api/purchases/invoice-scan/duplicates`.
   */
  duplicateFetcher?: InvoiceDuplicatesFetcher;
};

/**
 * Destino del foco tras una acción de teclado; `seq` fuerza el efecto aunque se
 * repita. `need`: campo que le falta a la línea (con producto) para resolverse.
 */
/** `needsSupplier`: sin línea pendiente y sin proveedor, Cargar está deshabilitado (REP3-03a). */
/**
 * `choice`: producto aceptado sin la elección explícita (D31). D36: el foco va a la FILA y su
 * aviso se resalta y se anuncia; la opción solo la enfoca el usuario (Tab desde la fila).
 */
type FocusRequest = {
  target: number | null;
  need?: string;
  needsSupplier?: boolean;
  choice?: boolean;
  /**
   * D43/D46-a: la acción vino del puntero (layout pendiente). El foco no desplaza la página: un
   * desplazamiento dejaría otro control bajo el dedo que acaba de pulsar.
   */
  keepScroll?: boolean;
  seq: number;
};

const NEED_FOCUS_ORDER = ["unitsPerPack", "quantity", "unitPrice"] as const;

/**
 * D31 (C5-M1): tras plegar/desplegar una fila (o dejar una línea a la espera de la opción
 * explícita) se ignoran las activaciones de candidato durante este tiempo: el 2.º Enter de un
 * rebote o el 2.º clic de un doble clic caerían sobre la fila siguiente. D36: es una defensa
 * adicional; lo que impide elegir por rebote es que el foco nunca va solo a un control que decide.
 * D46-b la complementa para el puntero con la guarda espacial (`isSpatialRebound`).
 */
const ACTIVATION_GUARD_MS = 400;

/** D46-a: orden de las filas que se está pintando (índices por lista). */
type RowOrder = { review: number[]; confirmed: number[] };

/** Solo desde manejadores de eventos (nunca en render). */
function armGuard(until: { current: number }) {
  until.current = Date.now() + ACTIVATION_GUARD_MS;
}

function isGuarded(until: { current: number }) {
  return Date.now() < until.current;
}

/**
 * D33-a (C6-M1): teclas que activan algo en la revisión. Una tecla mantenida al mover el foco
 * no actúa sobre el nuevo destino hasta que se suelte (aunque el sistema no marque `repeat`).
 */
const ACTIVATION_KEYS = new Set(["Enter", " ", "Escape"]);

/** D33-a: controles cuyo 2.º clic de un doble clic (`detail > 1`) se ignora. */
const ACTIVATION_SELECTOR = "[data-candidate], [data-choice], [data-cost-ack], [data-row-action], [data-load-button]";

/**
 * REP6-05: selector de tasa y botones del pie distintos de Cargar. Filtro de D33-a (sin
 * `repeat`, sin `detail > 1` y liberación nueva tras mover el foco), aplicado en la captura del
 * clic porque sus manejadores no pasan por `applyRowAction`. La guarda de 400 ms es de las filas.
 */
const GUARDED_CONTROL_SELECTOR = "[data-guarded-activation]";

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

/** Separación mínima entre el control enfocado y el pie fijo (px). */
const FOOTER_GAP = 8;

/**
 * REP9-02: mantiene la fila `index` en el grupo de confirmadas (orden por índice, como el modelo)
 * aunque el modelo ya la mande a revisar; su estado no cambia, solo dónde se monta.
 */
function keepInConfirmed(sections: InvoiceReviewSections, index: number | null): InvoiceReviewSections {
  const line = index === null ? undefined : sections.review.find((item) => item.index === index);
  if (!line) {
    return sections;
  }
  return {
    ...sections,
    review: sections.review.filter((item) => item !== line),
    confirmed: [...sections.confirmed, line].sort((left, right) => left.index - right.index),
  };
}

/** D46-a: con el layout pendiente, cada fila sigue en la lista y el puesto en que se pintaba. */
function keepRowOrder(
  sections: InvoiceReviewSections,
  order: RowOrder | undefined,
  lines: InvoiceReviewState["lines"],
): InvoiceReviewSections {
  if (!order) {
    return sections;
  }
  return {
    ...sections,
    review: order.review.map((index) => lines[index]),
    confirmed: order.confirmed.map((index) => lines[index]),
  };
}

/**
 * QA REP4-02c F1: `focus()` no desplaza si el elemento está dentro del viewport aunque lo
 * tape el pie fijo (sticky). El margen de scroll con el alto actual del pie (varía al
 * desplegar el detalle en móvil) hace que `scrollIntoView` lo deje por encima del pie.
 * QA REP4-02c-F1 (intento 2): el pie sticky no está pegado al borde del viewport (padding
 * inferior de `main`), así que el margen es la zona que tapa realmente desde ese borde.
 */
function focusAboveFooter(element: HTMLElement, footer: HTMLElement | null) {
  element.focus();
  scrollAboveFooter(element, footer);
}

function scrollAboveFooter(element: HTMLElement, footer: HTMLElement | null) {
  // Un pie sin altura (oculto o sin layout) no tapa nada.
  const visibleFooter = footer && footer.getBoundingClientRect().height > 0 ? footer : null;
  const covered = visibleFooter
    ? Math.max(0, window.innerHeight - visibleFooter.getBoundingClientRect().top + FOOTER_GAP)
    : 0;
  element.style.scrollMarginBottom = `${covered}px`;
  // jsdom no implementa scrollIntoView.
  element.scrollIntoView?.({ block: "nearest" });
  if (!visibleFooter) return;
  // Cubre contenedores con scroll propio o casos en que scrollIntoView no basta.
  const overlap =
    element.getBoundingClientRect().bottom -
    (visibleFooter.getBoundingClientRect().top - FOOTER_GAP);
  if (overlap > 0) window.scrollBy(0, overlap);
}

/**
 * SCN-08b · Pantalla de revisión del escaneo DENTRO de `/purchases/create` (la
 * página la muestra en lugar del formulario mientras se revisa). Toda la regla
 * es de `reviewModel.ts`: aquí solo se pinta y se despachan acciones.
 *
 * Teclado (6.17): `Enter` sobre una línea pendiente acepta el candidato marcado y
 * pasa el foco a la siguiente pendiente; `Tab` abre su buscador; `Esc` la deja sin
 * emparejar; las flechas marcan otro candidato (D39-7: con la guarda y solo si el usuario ya
 * actuó en esa fila). Las confirmadas no entran en el recorrido.
 * D36: con aviso de precio/empaque, Enter solo resalta el aviso y `Tab` lleva a «Por unidad»;
 * la opción se elige con Enter o Espacio sobre ella (D39-5: las flechas solo mueven el foco entre
 * las opciones). D39-6: elegida, el foco queda en la fila resuelta; Enter sobre ella avanza a la
 * siguiente pendiente. Sin pendientes, el foco va al pie
 * (contenedor) y Tab llega a Cargar: nunca se enfoca solo una opción, la casilla de diferencia,
 * «Descartar escaneo» ni Cargar.
 */
export function InvoiceReviewPanel({
  canCreateProduct = false,
  context,
  duplicateFetcher,
  lastUnitCostFetcher = fetchLastUnitCostRef,
  onDiscard,
  onLoad,
  onRescan,
  productFetcher,
  response,
  supplierFetcher,
}: InvoiceReviewPanelProps) {
  const { dispatch, state, summary } = useInvoiceReview(response, context);
  // REP6-05: la tasa del día que llega con la revisión ya abierta pasa a ser la preseleccionada
  // (el reductor la ignora si ya había tasa del día o el usuario eligió una).
  const lateSystemRate = context.systemRateVes;
  useEffect(() => {
    if (lateSystemRate !== undefined) {
      dispatch({ type: "adoptSystemRate", systemRateVes: lateSystemRate });
    }
  }, [dispatch, lateSystemRate]);
  // D42: consulta el último costo de cada producto elegido en el buscador, una vez por (línea,
  // producto) en curso; la respuesta para un producto que ya no es el de la línea se ignora.
  const lastCostRequestsRef = useRef(new Set<string>());
  const supplierId = state.header.supplier.contactId;
  useEffect(() => {
    for (const line of state.lines) {
      const lookup = line.lastCostLookup;
      if (lookup?.status !== "loading" || lookup.productId !== line.productId) {
        continue;
      }
      const { index } = line;
      const { productId } = lookup;
      const key = `${index}:${productId}`;
      if (lastCostRequestsRef.current.has(key)) {
        continue;
      }
      lastCostRequestsRef.current.add(key);
      lastUnitCostFetcher(productId, supplierId)
        .then(
          (result) => dispatch({ type: "setLastUnitCost", index, productId, result }),
          () => dispatch({ type: "setLastUnitCost", index, productId, result: "error" }),
        )
        .finally(() => lastCostRequestsRef.current.delete(key));
    }
  }, [dispatch, lastUnitCostFetcher, state.lines, supplierId]);
  // REP12-01 (D52): al cambiar el proveedor (o el número/fecha) se vuelve a consultar el duplicado;
  // el aviso no bloquea, pero Cargar exige reconocerlo (por escaneo previo al que apunta).
  // Intento 2: mientras la consulta vigente no responde, Cargar no carga (el aviso del escaneo no
  // vale para otro proveedor/número/fecha), salvo que sea la que el escaneo ya respondió: el
  // proveedor leído (el elegido igual al leído no cambia la consulta) con el número y la fecha leídos.
  const readContactId = response.matched.supplier.contactId;
  const duplicateQuery = (chosen: string | undefined, number: string | undefined, date: string | undefined) =>
    buildInvoiceDuplicateQuery({
      scanId: state.scanId,
      supplierId: chosen === readContactId ? undefined : chosen,
      contactId: readContactId,
      taxId: state.extraction.supplier.taxId,
      number,
      date,
      total: state.extraction.total,
    });
  const duplicates = useInvoiceDuplicates(
    duplicateQuery(supplierId, state.header.number, state.header.date),
    duplicateFetcher,
    duplicateQuery(readContactId, state.extraction.number, state.extraction.date),
  );
  const duplicateKey = duplicates.matches ? (duplicates.matches[0]?.scanId ?? null) : (state.duplicateOfScanId ?? null);
  const [acknowledgedDuplicate, setAcknowledgedDuplicate] = useState<string | null>(null);
  const duplicateUnacknowledged = duplicateKey !== null && acknowledgedDuplicate !== duplicateKey;
  const duplicateCheckboxRef = useRef<HTMLInputElement>(null);
  const [searchIndex, setSearchIndex] = useState<number | null>(null);
  const [confirmedOpen, setConfirmedOpen] = useState(false);
  // REP9-02: confirmada en cuyo campo se está escribiendo; no cambia de lista hasta que el foco salga
  // de su fila (su estado sí cambia con cada tecla: D42 no se relaja).
  const [heldConfirmedIndex, setHeldConfirmedIndex] = useState<number | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [newProduct, setNewProduct] = useState<{ index: number; values: ProductFormInitialValues } | null>(null);
  const [discardScanOpen, setDiscardScanOpen] = useState(false);
  // Al abrir la revisión el foco va a la primera pendiente: se puede resolver sin ratón.
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(() => {
    const first = nextPendingIndex(state, null);
    return first === null ? null : { seq: 0, target: first };
  });
  const rowRefs = useRef(new Map<number, HTMLLIElement>());
  const footerRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const newProductOpenerRef = useRef<HTMLElement | null>(null);
  const guardUntilRef = useRef(0);
  // REP6-04 (B6-2): línea cuya opción explícita armó la guarda; corregir la opción en esa misma
  // línea no es un rebote sobre otra fila y se aplica. Cualquier otro armado lo anula.
  const guardChoiceIndexRef = useRef<number | null>(null);
  // D33-a: teclas de activación y punteros pulsados ahora; al mover el foco con alguno pulsado,
  // hace falta un keyup/pointerup nuevo antes de aceptar otra activación.
  const pressedRef = useRef(new Set<string>());
  const awaitingReleaseRef = useRef(false);
  // D39-7 (C8-M1): fila a la que se llevó el foco por programa; sus flechas no marcan candidato
  // hasta que el usuario actúe en ella (Enter/Espacio, puntero, o salir y volver a la fila).
  const autoFocusedRowRef = useRef<number | null>(null);
  // D46: tras una activación con el puntero, las filas conservan caja y orden (layout pendiente) y
  // otra activación en el mismo punto sobre un control distinto se ignora durante 1 s. D49: el
  // layout se aplica al desplazar, con teclado o al salir el ratón del panel, nunca por tiempo.
  const rootRef = useRef<HTMLDivElement>(null);
  const layoutHold = useLayoutHold<RowOrder>(rootRef, (key) => {
    // Al aplicarse el layout, la fila con el foco cambió de lista: el foco vuelve a ella sin desplazar
    // (o al pie si no lo admite); nunca se queda en BODY.
    const row = key.startsWith("row:") ? rowRefs.current.get(Number(key.slice("row:".length))) : undefined;
    (row?.hasAttribute("tabindex") ? row : footerRef.current)?.focus({ preventScroll: true });
  });
  const lastPointerActivationRef = useRef<PointerActivation | null>(null);
  // B-p11-1: elección con el puntero en una lista flotante (portal); lo que destapó al cerrarse no se
  // acciona en ese punto hasta que el puntero se aleje o pase REVEAL_GUARD_MS.
  const revealActivationRef = useRef<PointerActivation | null>(null);
  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const reveal = revealActivationRef.current;
      if (reveal && Math.hypot(event.clientX - reveal.x, event.clientY - reveal.y) >= POINTER_GUARD_RADIUS_PX) {
        revealActivationRef.current = null;
      }
    };
    window.addEventListener("pointermove", onPointerMove, true);
    return () => window.removeEventListener("pointermove", onPointerMove, true);
  }, []);
  /** D46-b, D49 y B-p11-1: la activación con el puntero cae en algo que apareció o se movió bajo él. */
  function isPointerGuarded(activation: PointerActivation) {
    return (
      isSpatialRebound(lastPointerActivationRef.current, activation) ||
      isSpatialRebound(revealActivationRef.current, activation, REVEAL_GUARD_MS) ||
      layoutHold.movedByCompaction(activation.control)
    );
  }
  const taxRates = useMemo(() => buildReviewTaxRates(state.taxRates), [state.taxRates]);
  const modelSections = getReviewSections(state);
  const sections = keepRowOrder(keepInConfirmed(modelSections, heldConfirmedIndex), layoutHold.order, state.lines);
  // Una confirmada cuyo cantidad × costo no cuadra sigue colapsada (el orden es del
  // modelo), pero el botón lo dice para que se abra a revisarla.
  const confirmedMismatches = sections.confirmed.filter((line) =>
    summary.totals.lineMismatches.includes(line.index),
  ).length;
  // D36: línea a la que se llevó el foco porque le falta la opción explícita; su aviso se resalta.
  const noticeLine =
    focusRequest?.choice && focusRequest.target !== null ? state.lines[focusRequest.target] : undefined;
  const choiceNotice = noticeLine && needsOptionChoice(state, noticeLine) ? noticeLine : undefined;

  function armActivationGuard() {
    armGuard(guardUntilRef);
    guardChoiceIndexRef.current = null;
  }

  function activationGuarded() {
    return awaitingReleaseRef.current || isGuarded(guardUntilRef);
  }

  // D33-a: la tecla o el puntero pueden soltarse fuera del panel (arrastre, Alt+Tab, foco en otro
  // árbol); se escucha en `window` y se vacía el estado si la ventana pierde el foco o se oculta.
  useEffect(() => {
    const pressed = pressedRef.current;
    const release = (input: string) => {
      pressed.delete(input);
      awaitingReleaseRef.current = false;
    };
    const releaseAll = () => {
      pressed.clear();
      awaitingReleaseRef.current = false;
    };
    const onKeyUp = (event: globalThis.KeyboardEvent) => release(`key:${event.key}`);
    const onPointerUp = (event: PointerEvent) => release(`pointer:${event.pointerId}`);
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        releaseAll();
      }
    };
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerUp, true);
    window.addEventListener("blur", releaseAll);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerUp, true);
      window.removeEventListener("blur", releaseAll);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  /**
   * Pide el foco para `target` según el estado que resultará de la acción (`next`).
   * REP7-06 (C5-M1, D31/D33): todo cambio de foco programático arma la guarda; el 2.º Enter o
   * clic de un rebote no actúa sobre la fila (o el pie) a la que se acaba de llevar el foco.
   */
  function requestFocus(target: number | null, next: InvoiceReviewState) {
    awaitingReleaseRef.current = pressedRef.current.size > 0;
    armActivationGuard();
    const line = target === null ? undefined : next.lines[target];
    // Con el producto ya aceptado pero sin poder resolverse (falta el tamaño del empaque,
    // la cantidad…) el foco va al campo que falta. Sin aceptar, a la fila: Enter acepta primero.
    const needs = line?.productId && line.accepted ? getLineNeeds(line) : [];
    const need = NEED_FOCUS_ORDER.find((item) => needs.includes(item));
    // D31/D42: aceptado por cualquier vía y completo, pero falta la elección explícita. D36: el foco
    // se queda en la fila (con el aviso resaltado); nunca va solo a «Por unidad / Por caja».
    const choice =
      !need && line !== undefined && line.accepted && isPendingStatus(line.status) && needsOptionChoice(next, line);
    const needsSupplier = target === null && !next.header.supplier.contactId;
    const keepScroll = layoutHold.isHolding();
    setFocusRequest((current) => ({
      seq: (current?.seq ?? 0) + 1,
      target,
      ...(need ? { need } : {}),
      ...(needsSupplier ? { needsSupplier } : {}),
      ...(choice ? { choice } : {}),
      ...(keepScroll ? { keepScroll } : {}),
    }));
  }

  useEffect(() => {
    if (!focusRequest) {
      return;
    }
    const row = focusRequest.target === null ? undefined : rowRefs.current.get(focusRequest.target);
    if (!row) {
      // Sin pendientes (o sin la fila en el DOM: una confirmada descartada se pliega). El foco
      // nunca se queda en BODY (QA B7): va al buscador de proveedor si falta y, si no, al pie
      // como contenedor (D36: nunca a Cargar, la casilla de diferencia ni «Descartar escaneo»,
      // donde un 2.º Enter o Espacio de rebote decidiría). Desde el pie, Tab llega a Cargar.
      const supplier = focusRequest.needsSupplier
        ? headerRef.current?.querySelector<HTMLInputElement>('input[role="combobox"]')
        : null;
      autoFocusedRowRef.current = null;
      (supplier ?? footerRef.current)?.focus({ preventScroll: focusRequest.keepScroll });
      return;
    }
    const field = focusRequest.need
      ? row.querySelector<HTMLInputElement>(`[data-need="${focusRequest.need}"]`)
      : null;
    if (document.activeElement !== row) {
      autoFocusedRowRef.current = field ? null : focusRequest.target;
    }
    if (focusRequest.keepScroll) {
      (field ?? row).focus({ preventScroll: true });
      return;
    }
    focusAboveFooter(field ?? row, footerRef.current);
    // REP7-06 (QA F1, B8 a 390 px): la fila con aviso puede ser más alta que la franja entre la
    // barra superior y el pie; el aviso resaltado va al final y quedaba bajo el pie. El foco se
    // queda en la fila, pero lo que se lleva a la vista por encima del pie es su aviso.
    const notices = focusRequest.choice
      ? row.querySelector<HTMLElement>('[data-testid="invoice-review-line-notices"]')
      : null;
    if (notices) {
      scrollAboveFooter(notices, footerRef.current);
    }
  }, [focusRequest]);

  /**
   * Producto elegido en el buscador o creado con «Nuevo producto». D39-6: resuelta o no, el foco
   * queda en su fila (o en el campo que falta); avanzar es del usuario.
   */
  function applyProductChoice(action: InvoiceReviewAction & { index: number }) {
    const next = reviewReducer(state, action);
    dispatch(action);
    requestFocus(action.index, next);
  }

  /**
   * Descartar/Restaurar mueven el foco (D29): el botón pulsado deja de existir. D31: va al
   * contenedor de la fila (la siguiente pendiente, la restaurada o, sin pendientes, la
   * descartada), nunca a un botón de acción, y se ignoran activaciones de candidato un rato.
   */
  function applyRowAction(action: InvoiceReviewAction) {
    if (action.type === "acceptCandidate" || action.type === "editEntryMode") {
      const sameLineChoiceFix =
        action.type === "editEntryMode" &&
        !awaitingReleaseRef.current &&
        guardChoiceIndexRef.current === action.index;
      if (activationGuarded() && !sameLineChoiceFix) {
        return;
      }
      const current = state.lines[action.index];
      const next = reviewReducer(state, action);
      dispatch(action);
      const line = next.lines[action.index];
      // D43: también la elección que deja el costo por reconocer (p. ej. de resuelta a «Por bulto»
      // desviada): arma la guarda antes de que «Sí, el costo es…» pueda activarse.
      const choosing =
        action.type === "editEntryMode" &&
        current !== undefined &&
        (needsOptionChoice(state, current) || (line !== undefined && awaitsCostAcknowledgement(next, line)));
      // D42: una confirmada cuyo costo pasa a desviarse sale del grupo de confirmadas; su opción se
      // desmonta y el foco nunca cae en BODY: va a la fila, ya en la lista por revisar.
      const inConfirmed = (from: InvoiceReviewState) =>
        getReviewSections(from).confirmed.some((item) => item.index === action.index);
      const movedSection = action.type === "editEntryMode" && inConfirmed(state) !== inConfirmed(next);
      if ((choosing || movedSection) && line) {
        // D39-6: elegida la opción, el foco queda en su fila (resuelta o no); avanzar es del usuario.
        requestFocus(action.index, next);
        guardChoiceIndexRef.current = action.index;
      } else if (action.type === "acceptCandidate" && line && needsOptionChoice(next, line)) {
        // Clic deliberado en el chip: el producto queda elegido, pero falta la opción (D31);
        // el foco va a la fila con el aviso resaltado (D36).
        requestFocus(action.index, next);
      } else if (action.type === "acceptCandidate" && line && !isPendingStatus(line.status)) {
        // Resuelta: el chip pulsado desaparece y el foco nunca cae en BODY. D39-6 (B-p9-1): queda
        // en su fila; avanzar es del usuario.
        requestFocus(action.index, next);
      }
      return;
    }
    if (action.type === "acknowledgeCost") {
      // D43 (B-r9-1): reconocer el costo es una activación más (guarda, liberación nueva, sin
      // `detail > 1`), sin la excepción de corregir la opción de la misma línea. El botón deja de
      // existir: el foco va a su fila.
      if (activationGuarded()) {
        return;
      }
      const next = reviewReducer(state, action);
      dispatch(action);
      requestFocus(action.index, next);
      return;
    }
    if (action.type === "convertPackToUnits") {
      // B-p7-1: «Cargar como N unidades» deja de existir al pulsarse; D36: el foco va a la fila,
      // nunca a un control que decide. D39-6 (B-p9-1): también si la deja resuelta. Una confirmada
      // por el emparejamiento no recibe foco: sigue el recorrido.
      const next = reviewReducer(state, action);
      dispatch(action);
      const line = next.lines[action.index];
      requestFocus(line?.status === "confirmed_by_match" ? nextPendingIndex(next, action.index) : action.index, next);
      return;
    }
    if (action.type !== "discardLine" && action.type !== "restoreLine") {
      dispatch(action);
      return;
    }
    const next = reviewReducer(state, action);
    dispatch(action);
    if (action.type === "restoreLine") {
      requestFocus(action.index, next);
      return;
    }
    requestFocus(nextPendingIndex(next, action.index) ?? action.index, next);
  }

  /**
   * Acciones del encabezado y de los avisos. B-p7-1: «Sí, la factura está en dólares» y el
   * proveedor sugerido desaparecen al pulsarse; el foco va a la primera pendiente (o al pie).
   */
  function applyPanelAction(action: InvoiceReviewAction) {
    const focused = document.activeElement;
    const next = reviewReducer(state, action);
    dispatch(action);
    const unmountsFocused =
      (action.type === "acceptUsdAnomaly" && next !== state) ||
      (action.type === "setSupplier" && focused instanceof Element && focused.matches("[data-supplier-candidate]"));
    if (unmountsFocused) {
      requestFocus(nextPendingIndex(next, null), next);
    }
  }

  /** Enter que acepta el marcado (fila o campo que pide la línea); D31: nunca a ciegas. */
  function acceptMarkedByEnter(index: number) {
    if (activationGuarded()) {
      return;
    }
    const result = pressEnter(state, index);
    dispatch({ type: "acceptMarked", index });
    if (result.next !== index) {
      setSearchIndex(null);
    }
    requestFocus(result.next, result.state);
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
          acceptMarkedByEnter(index);
        } else if (current && !isPendingStatus(current.status)) {
          requestFocus(nextPendingIndex(state, index), state);
        }
      }
      return;
    }
    const line = state.lines[index];
    // D39-7: Enter o Espacio deliberados sobre la fila cuentan como acción del usuario en ella.
    if ((event.key === "Enter" || event.key === " ") && !activationGuarded() && autoFocusedRowRef.current === index) {
      autoFocusedRowRef.current = null;
    }
    switch (event.key) {
      case "Enter": {
        event.preventDefault();
        if (line && !isPendingStatus(line.status)) {
          // D39-6: sobre la fila resuelta (foco tras elegir su opción), Enter avanza a la siguiente.
          if (!activationGuarded()) {
            requestFocus(nextPendingIndex(state, index), state);
          }
          return;
        }
        acceptMarkedByEnter(index);
        return;
      }
      case " ": {
        // REP6-04 (B6-1): Espacio no tiene acción en la fila; sin esto desplaza el panel.
        event.preventDefault();
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
        // D39-6: desde una fila resuelta o descartada, Tab sigue el orden normal del documento.
        if (event.shiftKey || !line || !isPendingStatus(line.status)) {
          return;
        }
        event.preventDefault();
        // D36/D42: aceptada a la espera de la opción explícita: Tab lleva a «Por unidad», sin elegirla.
        // D43: ya elegida y con el costo por reconocer, a «Sí, el costo es…», sin activarlo.
        const option =
          line?.accepted && needsOptionChoice(state, line)
            ? (event.currentTarget.querySelector<HTMLElement>("[data-cost-ack]") ??
              event.currentTarget.querySelector<HTMLElement>("[data-choice]"))
            : null;
        if (option) {
          focusAboveFooter(option, footerRef.current);
        } else if (searchIndex === index) {
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
        const chips = line && isPendingStatus(line.status) ? getChoiceChips(line) : [];
        if (!line || chips.length === 0) {
          return;
        }
        event.preventDefault();
        // D39-7: la misma guarda que activar, y nunca en una fila a la que el foco llegó solo.
        if (activationGuarded() || autoFocusedRowRef.current === index) {
          return;
        }
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
    applyProductChoice({ type: "chooseProduct", index, product });
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
    // D33-a: el rebote de la elección que resolvió la última línea no carga el borrador.
    if (activationGuarded() || duplicates.pending || duplicateUnacknowledged) {
      return;
    }
    const draft = buildInvoiceReviewDraft(state);
    if (draft) {
      onLoad(draft);
    }
  }

  /** REP9-02: escribir en un campo de una confirmada la fija en su lista (no se desmonta). */
  function handleConfirmedFocus(event: FocusEvent<HTMLUListElement>) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
      return;
    }
    const index = Number(target.closest("[data-line-index]")?.getAttribute("data-line-index"));
    if (Number.isInteger(index)) {
      setHeldConfirmedIndex(index);
    }
  }

  /**
   * Al salir el foco de la fila fijada, toma la lista que le toca. Si cambia de lista y el foco
   * no fue a otro control, va a la fila ya movida (nunca a BODY).
   */
  function handleConfirmedBlur(event: FocusEvent<HTMLUListElement>) {
    if (heldConfirmedIndex === null) {
      return;
    }
    const next = event.relatedTarget;
    if (next instanceof Node && rowRefs.current.get(heldConfirmedIndex)?.contains(next)) {
      return;
    }
    setHeldConfirmedIndex(null);
    const moves = !modelSections.confirmed.some((line) => line.index === heldConfirmedIndex);
    if (moves && !(next instanceof Element)) {
      requestFocus(heldConfirmedIndex, state);
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
        noticeHighlighted={choiceNotice?.index === line.index}
        onAcceptByKey={(action) => {
          if ("index" in action && !activationGuarded()) {
            // D39-6 (B-p9-1): resuelta o no, el foco queda en su fila (o en el campo que falta).
            const next = reviewReducer(state, action);
            dispatch(action);
            requestFocus(action.index, next);
          }
        }}
        layoutBox={`row:${line.index}`}
        layoutStyle={layoutHold.boxStyle(`row:${line.index}`)}
        onAction={applyRowAction}
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
    <div
      className="flex min-w-0 flex-col gap-4"
      data-layout-box="panel"
      data-testid="invoice-review-panel"
      // D33-a (C6-M1): la autorrepetición del teclado y el 2.º clic de un doble clic no activan
      // nada (fila, chip, opción, Descartar/Restaurar, Cargar).
      onClickCapture={(event) => {
        if (!(event.target instanceof Element)) {
          return;
        }
        const guardedControl = event.target.closest(GUARDED_CONTROL_SELECTOR);
        if (
          (event.detail > 1 && (guardedControl || event.target.closest(ACTIVATION_SELECTOR))) ||
          (guardedControl && awaitingReleaseRef.current)
        ) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        const activation = readPointerActivation(event);
        if (!activation) {
          return;
        }
        // D46-b: lo que apareció bajo el dedo tras la activación anterior no se acciona. D49: tampoco
        // lo que movió la aplicación del layout pendiente hace menos de 1 s. B-p11-1: ni lo que destapó
        // una lista flotante al elegir en ella.
        if (isPointerGuarded(activation)) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        lastPointerActivationRef.current = activation;
        // La lista del buscador vive en un portal: su clic llega por el árbol de React, no por el DOM.
        revealActivationRef.current = rootRef.current?.contains(activation.control) ? null : activation;
        // D46-a: antes de que la acción cambie nada, se fijan las cajas y el orden actuales.
        layoutHold.holdLayout(activation.control, {
          review: sections.review.map((line) => line.index),
          confirmed: sections.confirmed.map((line) => line.index),
        });
      }}
      onKeyDownCapture={(event) => {
        if (event.repeat && (event.key === "Enter" || event.key === "Escape")) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (ACTIVATION_KEYS.has(event.key)) {
          pressedRef.current.add(`key:${event.key}`);
        }
      }}
      // B-p11-2 (caos p11): el foco (y el teclado en pantalla) llega en el `mousedown`, antes del clic
      // que la guarda ignora: sobre un control guardado tampoco entra el foco.
      onMouseDownCapture={(event) => {
        const activation = readPointerActivation(event);
        if (activation && isPointerGuarded(activation)) {
          event.preventDefault();
        }
      }}
      onPointerDownCapture={(event) => {
        pressedRef.current.add(`pointer:${event.pointerId}`);
        // D39-7: el puntero sobre la fila es acción del usuario en ella.
        if (
          event.target instanceof Element &&
          event.target.closest("[data-line-index]")?.getAttribute("data-line-index") ===
            String(autoFocusedRowRef.current)
        ) {
          autoFocusedRowRef.current = null;
        }
      }}
      ref={rootRef}
      style={layoutHold.boxStyle("panel")}
      onBlur={(event) => {
        // D39-7: si el foco sale de la fila llevada por programa, volver a ella es del usuario.
        if (event.target.getAttribute("data-line-index") === String(autoFocusedRowRef.current)) {
          autoFocusedRowRef.current = null;
        }
      }}
    >
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

      {/* D36: Enter sobre una fila con aviso no elige; se anuncia qué falta y cómo llegar a la opción. */}
      <p aria-live="polite" className="sr-only" data-testid="invoice-review-announcement">
        {choiceNotice
          ? `Línea ${choiceNotice.index + 1}: ${lineNeedMessages(state, choiceNotice).join(" ")} ${
              choiceNotice.choiceMade && awaitsCostAcknowledgement(state, choiceNotice)
                ? "Pulsa Tab para ir a confirmar el costo."
                : "Pulsa Tab para ir a las opciones."
            }`
          : ""}
      </p>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex min-w-0 flex-col gap-4">
          {/* D46-a: encabezado y avisos no encogen bajo el dedo (las filas subirían). */}
          <div className="flex min-w-0 flex-col gap-4" data-layout-box="header" style={layoutHold.boxStyle("header")}>
            <div ref={headerRef}>
              <InvoiceReviewHeader
                duplicateAcknowledged={!duplicateUnacknowledged}
                duplicateCheckboxRef={duplicateCheckboxRef}
                duplicates={duplicates.matches}
                onAction={applyPanelAction}
                onDuplicateAcknowledge={(acknowledged) => setAcknowledgedDuplicate(acknowledged ? duplicateKey : null)}
                onRescan={onRescan}
                state={state}
                supplierFetcher={supplierFetcher}
              />
            </div>
            <InvoiceReviewRateNotice onAction={applyPanelAction} state={state} />
            <InvoiceReviewTaxNotice onAction={dispatch} state={state} />
          </div>

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
            ) : modelSections.review.length === 0 && state.lines.length > 0 && !state.confirmedPurchase ? (
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
                  <ul
                    aria-label="Líneas confirmadas"
                    className="divide-y divide-border border-t border-border dark:divide-slate-800 dark:border-slate-800"
                    onBlur={handleConfirmedBlur}
                    onFocus={handleConfirmedFocus}
                  >
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
        detailStyle={layoutHold.boxStyle("footer-detail")}
        duplicatePending={duplicates.pending}
        duplicateUnacknowledged={duplicateUnacknowledged}
        footerRef={footerRef}
        onAction={dispatch}
        onDiscard={() => setDiscardScanOpen(true)}
        onLoad={handleLoad}
        onReviewDuplicate={() => {
          // El motivo del pie lleva a la casilla del aviso (arriba, en el encabezado).
          duplicateCheckboxRef.current?.scrollIntoView?.({ block: "center" });
          duplicateCheckboxRef.current?.focus({ preventScroll: true });
        }}
        state={state}
        summary={summary}
      />

      {/* D36 (C7-M3): descartar tira la revisión y volver a escanear cobra otra página. */}
      <ConfirmActionModal
        cancelLabel="Seguir revisando"
        confirmLabel="Descartar escaneo"
        description="Se cierra la revisión y se pierde lo que hayas corregido. Para usar esta factura habrá que escanearla otra vez, y cuenta como un escaneo nuevo."
        onConfirm={() => {
          setDiscardScanOpen(false);
          onDiscard();
        }}
        onOpenChange={setDiscardScanOpen}
        open={discardScanOpen}
        title="¿Descartar el escaneo?"
        variant="danger"
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
              applyProductChoice({
                type: "chooseProduct",
                index,
                product: { productId: product.id, name: product.name },
                created: true,
              });
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
