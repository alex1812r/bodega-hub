"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";

import type { RestockDraft } from "@/modules/inventory/restock";
import { InvoiceScanModal } from "@/modules/invoice-scan/client/components/InvoiceScanModal";
import type { InvoiceScanResponse } from "@/modules/invoice-scan/contracts";
import type { ProductWithCategory } from "@/modules/products/hooks/useProducts";
import type { ProductFormInitialValues } from "@/modules/products/product-details/components/ProductFormModal";
import { useCurrentExchangeRate } from "@/modules/settings/hooks/useCurrentExchangeRate";
import { apiFetch } from "@/shared/api/apiFetch";
import { usePermission } from "@/shared/auth/usePermission";
import { ConfirmActionModal } from "@/shared/components/ConfirmActionModal";
import { ErrorState } from "@/shared/components/ErrorState";
import { LoadingState } from "@/shared/components/LoadingState";
import { ProcessGuardModal, useProcessGuard } from "@/shared/components/ProcessGuard";
import { useToast } from "@/shared/components/Toast";
import { useTaxRates } from "@/shared/hooks/useTaxRates";
import type { PurchaseStatus } from "@/shared/mocks/erp-data";
import {
  type PaymentFormValues,
  amountForMethodChange,
  createEmptyPaymentFormValues,
} from "@/shared/payments/PaymentFormFields";
import {
  DEFAULT_ENABLED_PAYMENT_METHODS,
  filterEnabledPaymentMethods,
} from "@/shared/payments/paymentMethods";
import { refToVes, roundMoney } from "@/shared/utils/currency";

import { InvoiceReviewPanel } from "./invoice-scan/components/InvoiceReviewPanel";
import {
  applyInvoiceReviewDraft,
  buildInvoiceScanSubmission,
  describeInvoiceForNotes,
  describeLearnedAliases,
  pruneLoadedInvoiceScan,
  type LoadedInvoiceScan,
} from "./invoice-scan/loadedInvoiceScan";
import type { InvoiceReviewDraft } from "./invoice-scan/reviewDraft";
import { PurchaseConfirmModal } from "./components/PurchaseConfirmModal";
import { PurchaseCreateHeader } from "./components/PurchaseCreateHeader";
import { PurchaseDraftBanner } from "./components/PurchaseDraftBanner";
import { PurchaseFormNotices } from "./components/PurchaseFormNotices";
import { PurchaseNewProductModal } from "./components/PurchaseNewProductModal";
import { PurchasePaymentSection } from "./components/PurchasePaymentSection";
import {
  PurchaseProductPickerCard,
  type PurchaseCatalogProduct,
  type PurchaseProductPickerHandle,
} from "./components/PurchaseProductPickerCard";
import { usePurchaseDraftStorage } from "./hooks/usePurchaseDraftStorage";
import { usePurchaseDuplicateSource } from "./hooks/usePurchaseDuplicateSource";
import { usePurchaseLines } from "./hooks/usePurchaseLines";
import { usePurchaseLockOnAdd } from "./hooks/usePurchaseLockOnAdd";
import { usePurchasePackConversions } from "./hooks/usePurchasePackConversions";
import { usePurchasePaymentMethods } from "./hooks/usePurchasePaymentMethods";
import { usePurchaseProductSearch } from "./hooks/usePurchaseProductSearch";
import { consumeRestockDraft, usePurchaseRestockSource } from "./hooks/usePurchaseRestockSource";
import { PurchaseStatusNotesCard } from "./components/PurchaseStatusNotesCard";
import {
  PURCHASE_DISCOUNT_OVER_SUBTOTAL_MESSAGE,
  PurchaseSummaryCard,
  isPurchaseDiscountOverSubtotal,
} from "./components/PurchaseSummaryCard";
import { PurchaseSupplierCard } from "./components/PurchaseSupplierCard";
import type { PurchaseLineItemMeta } from "./components/PurchaseLineItemsTable";
import { useCreatePurchase, type PurchaseDetails } from "../hooks/usePurchases";
import { fetchPurchaseSupplier } from "../hooks/usePurchaseSuppliers";
import { withLastPurchaseCosts } from "./services/purchaseLastCosts";
import { resolvePurchaseProducts } from "./services/resolvePurchaseProducts";
import type { PurchaseCostCurrency, PurchaseDraftItem } from "./types";
import { buildUnlinkedCatalogProduct } from "./utils/buildPurchaseCatalog";
import { buildPurchaseLine, nextPurchaseLineId } from "./utils/buildPurchaseLine";
import { type PurchaseConfirmInput, purchaseConfirmKey } from "./utils/purchaseConfirmEffect";
import { describeConfirmError } from "./utils/purchaseConfirmError";
import {
  buildDuplicatedPurchaseLines,
  type PurchaseLineSource,
} from "./utils/duplicatePurchase";
import { draftToPurchaseItemInput, sumDraftPurchaseTotals } from "./utils/normalizePurchaseLine";
import {
  describeDraftSupplierUnavailable,
  restorePurchaseDraft,
  storedDraftSourceItems,
  toStoredInvoiceScan,
  type PurchaseDraftContent,
} from "./utils/purchaseDraftStorage";
import { describePurchaseInProgress } from "./utils/purchaseProcessLabel";
import { PurchaseSubmitAttempt } from "./utils/purchaseSubmitAttempt";
import {
  InitialPaymentKey,
  buildInitialPaymentFailedNotice,
  resolveInitialPayment,
} from "./utils/purchaseInitialPayment";
import {
  purchaseLineDisassemblePayload,
  readPurchasePackRecipes,
  withPurchaseLineDisassemble,
} from "./utils/purchaseLineDisassemble";
import { getEditedLinesSummary } from "./utils/purchaseLineReview";
import {
  RESTOCK_UNAVAILABLE_MESSAGE,
  buildRestockPurchaseLines,
  describeRestockAwaitingSupplier,
  describeRestockOmitted,
} from "./utils/restockPurchase";
import {
  buildExemptOverrideNotice,
  buildPurchaseTaxBreakdown,
  buildPurchaseWebLines,
  countManualLinesLostToExempt,
  findExemptTaxRate,
} from "./utils/purchaseLineTax";

/** `/purchases/create?scan=1` abre el escaneo de factura al entrar (vacío de la lista). */
const INVOICE_SCAN_QUERY_PARAM = "scan";
const INVOICE_SCAN_PROCESS_LABEL = "Escaneo de factura en curso";
const INVOICE_SCAN_LEAVE_DESCRIPTION = "Si sales ahora, la lectura de la factura se cancela.";
const INVOICE_REVIEW_PROCESS_LABEL = "Revisión de factura en curso";
const INVOICE_REVIEW_LEAVE_DESCRIPTION = "Si sales ahora, se pierde lo que revisaste de la factura.";

const LINE_TAX_MISSING_MESSAGE = "Elige una alícuota en cada línea antes de confirmar la compra.";

/** Respaldo de la tasa en una compra manual mientras no hay tasa del día. */
const FALLBACK_RATE_VES = 510;
const INVOICE_RATE_MISSING_MESSAGE =
  "No hay tasa del día ni tasa de la factura: registra la tasa del día para confirmar la compra.";

const PURCHASE_CHANGED_MESSAGE =
  "La compra cambió mientras la confirmabas: revisa las líneas y el resumen, y vuelve a confirmar.";

/**
 * Compra de origen (la que se duplica o un borrador restaurado, `fromDraft`) cuyo
 * proveedor ya no sirve: sus líneas esperan a que se elija otro.
 */
type PendingDuplicate = {
  fromDraft: boolean;
  items: PurchaseLineSource[];
  /** Aviso que explica por qué las líneas no están en el formulario. */
  notice: string;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : undefined;
}

/** Motivo en español de una petición que falló; sin respuesta (red), se dice así. */
function requestErrorMessage(error: unknown) {
  return error instanceof TypeError
    ? "No pudimos conectar con el servidor. Revisa tu conexión."
    : errorMessage(error);
}

export function PurchaseCreatePage() {
  const router = useRouter();
  const exchangeRate = useCurrentExchangeRate();
  const createPurchase = useCreatePurchase();
  // Cerrojo de «Confirmar Compra»: una clave por intento y ninguna tras confirmarla.
  const [requestAttempt] = useState(() => new PurchaseSubmitAttempt());
  // Clave del pago inicial: una por intento de compra, ligada a la clave de este.
  const [initialPaymentKey] = useState(() => new InitialPaymentKey());
  const { showToast } = useToast();
  const { can, isLoading: permissionsLoading } = usePermission();
  // Un pago de compra lo registra quien ve y gestiona pagos (regla de `POST /api/payments`).
  const canPayNow = can("payments.manage") && can("payments.view");
  // Sin ese permiso no hay sección "Pagar ahora" ni se piden sus métodos (responde 403).
  const enabledPaymentMethodsQuery = usePurchasePaymentMethods(canPayNow);
  // Catálogo completo: los chips muestran también una alícuota desactivada.
  const taxRates = useTaxRates({ activeOnly: false });
  const [supplierId, setSupplierId] = useState("");
  // Nombre del proveedor elegido: lo da quien lo elige (tarjeta, borrador, compra duplicada).
  const [supplierName, setSupplierName] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [status, setStatus] = useState<PurchaseStatus>("recibido");
  const [notes, setNotes] = useState("");
  const [discountRef, setDiscountRef] = useState(0);
  // `items` es el borrador de core. Su `taxRate` NO es la fuente de verdad: la alícuota de
  // cada línea se deriva de `taxState` en `lines`, que es lo que se pinta y se envía.
  // Bloqueos, historial de edición y alícuotas son estado de la web: no entran en el payload.
  const [{ disassemble, focus, items, locks, review, taxState }, dispatchLines] =
    usePurchaseLines();
  // Recetas de apertura activas de la tienda (COM-14): una consulta para toda la compra.
  // Si falla o el rol no puede verlas (no se piden: responde 403), ninguna línea ofrece
  // «Desarmar al recibir».
  const packConversions = usePurchasePackConversions(can("inventory.view"));
  // El alta rápida solo existe para quien puede crear productos; sin ese permiso no se
  // monta su formulario, que pide la configuración de precios de la tienda.
  const canCreateProduct = can("products.manage");
  // De la misma respuesta: los empaques cuya receta pide «Desarmar siempre al recibir
  // compras»; sus líneas nacen con el chip marcado (el usuario puede desmarcarlo).
  const { alwaysDisassembleProductIds, packProductIds } = useMemo(
    () => readPurchasePackRecipes(packConversions.data),
    [packConversions.data],
  );
  const [lockOnAdd, setLockOnAdd] = usePurchaseLockOnAdd();
  // Moneda en la que se teclean los costos: una sola para toda la compra.
  const [costCurrency, setCostCurrency] = useState<PurchaseCostCurrency>("ves");
  const [formError, setFormError] = useState<string | null>(null);
  // Intentos de confirmar: el aviso junto al botón se trae a la vista en cada uno.
  const [confirmAttempt, setConfirmAttempt] = useState(0);
  // "Pagar ahora" (COM-06): cerrada, la compra se confirma sin pago.
  const [payNow, setPayNow] = useState(false);
  const [storedPaymentValues, setPaymentValues] = useState<PaymentFormValues>(() =>
    createEmptyPaymentFormValues(),
  );
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentSubmitted, setPaymentSubmitted] = useState(false);
  // Alta rápida de producto (COM-03): `null` = cerrada; si no, con qué se prellena.
  const [newProductValues, setNewProductValues] = useState<ProductFormInitialValues | null>(null);
  // Quién abrió el alta rápida: recupera el foco si se cierra sin crear nada.
  const newProductOpenerRef = useRef<HTMLElement | null>(null);
  // Cola de escaneos del selector: ahí va también un código leído en Descuento.
  const pickerRef = useRef<PurchaseProductPickerHandle>(null);
  const [lineMetaByProductId, setLineMetaByProductId] = useState(
    () => new Map<string, PurchaseLineItemMeta>(),
  );
  // Borrador local (COM-09): lo guardado por una visita anterior se ofrece en un aviso.
  const draft = usePurchaseDraftStorage();
  const [isRestoringDraft, setIsRestoringDraft] = useState(false);
  // Lo que cambió al restaurar o duplicar (tasa, productos que se quitaron).
  const [notices, setNotices] = useState<string[]>([]);
  const [pendingDuplicate, setPendingDuplicate] = useState<PendingDuplicate | null>(null);
  const [isLoadingDuplicateLines, setIsLoadingDuplicateLines] = useState(false);
  // Reposición de stock bajo (INV-05) cuyas líneas esperan a que se elija el proveedor.
  const [pendingRestock, setPendingRestock] = useState<RestockDraft | null>(null);
  // Reposición que llegó con una compra en curso: espera a que el usuario decida.
  const [restockConflict, setRestockConflict] = useState<RestockDraft | null>(null);
  // Proveedor pedido (o `id: ""` = quitarlo) con líneas en la compra: espera la confirmación.
  const [supplierChangeRequest, setSupplierChangeRequest] = useState<{
    id: string;
    name?: string;
  } | null>(null);
  // Confirmación abierta (CNF-01): la huella de lo que el modal mostraba al abrirse.
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  // Compra ya creada: ni se vuelve a guardar el borrador ni se pregunta al salir.
  const [confirmed, setConfirmed] = useState(false);
  // Escaneo de factura (SCN-07): solo quien puede crear compras lo ve.
  const canScanInvoice = can("purchases.create");
  const [invoiceScanOpen, setInvoiceScanOpen] = useState(false);
  // Preparando, subiendo o leyendo: el guardia nombra el escaneo.
  const [invoiceScanBusy, setInvoiceScanBusy] = useState(false);
  // Factura leída en revisión (SCN-08c): mientras haya una, la página muestra la
  // revisión en lugar del formulario.
  const [scannedInvoice, setScannedInvoice] = useState<InvoiceScanResponse | null>(null);
  const reviewingInvoice = scannedInvoice !== null;
  // Escaneo cargado en el formulario: viaja con la compra y en el borrador local.
  const [loadedScan, setLoadedScan] = useState<LoadedInvoiceScan | null>(null);
  // Factura de otro proveedor con una compra en curso: espera «Reemplazar».
  const [invoiceReplaceRequest, setInvoiceReplaceRequest] = useState<InvoiceReviewDraft | null>(
    null,
  );
  const [isLoadingInvoice, setIsLoadingInvoice] = useState(false);
  const invoiceLoadingRef = useRef(false);
  const scanParamHandledRef = useRef(false);
  const productSearchResult = usePurchaseProductSearch(supplierId, productSearch);
  const catalog = productSearchResult.catalog;
  const currentRateVes = exchangeRate.data?.rateVes;
  // Con una factura cargada y sin tasa del día manda la elegida en la revisión (6.7): el
  // respaldo fijo solo sirve a la compra manual. `undefined` = factura sin ninguna tasa.
  const formRateVes = currentRateVes ?? (loadedScan ? loadedScan.invoiceRateVes : FALLBACK_RATE_VES);
  const invoiceRateMissing = formRateVes === undefined;
  const activeRateVes = formRateVes ?? FALLBACK_RATE_VES;
  // Código → % del catálogo: todo para la pista de la extracción, solo activas para la revisión.
  const taxPctByCode = useMemo(
    () => Object.fromEntries(taxRates.rates.map((rate) => [rate.code, rate.pct])),
    [taxRates.rates],
  );
  const reviewContext = useMemo(
    () => ({
      // La tasa del sistema, no el respaldo de 510: sin tasa del día la revisión lo dice.
      ...(currentRateVes !== undefined ? { systemRateVes: currentRateVes } : {}),
      taxRates: Object.fromEntries(
        taxRates.rates.filter((rate) => rate.isActive).map((rate) => [rate.code, rate.pct]),
      ),
    }),
    [currentRateVes, taxRates.rates],
  );

  // `/purchases/create?scan=1` (vacío de la lista): abre el escaneo una vez, cuando se
  // conocen los permisos, y quita el parámetro para que recargar no lo vuelva a abrir.
  useEffect(() => {
    if (scanParamHandledRef.current || permissionsLoading) {
      return;
    }

    scanParamHandledRef.current = true;
    const url = new URL(window.location.href);

    if (url.searchParams.get(INVOICE_SCAN_QUERY_PARAM) !== "1") {
      return;
    }

    url.searchParams.delete(INVOICE_SCAN_QUERY_PARAM);
    router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false });

    if (canScanInvoice) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- el parámetro de la URL solo se lee en el navegador y tras cargar los permisos; leerlo en render desajustaría la hidratación
      setInvoiceScanOpen(true);
    }
  }, [canScanInvoice, permissionsLoading, router]);

  useEffect(() => {
    if (!supplierId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- los metadatos de linea se vacian al quitar el proveedor y se fusionan con el catalogo al cargarlo; reordenarlo arriesga perder lineas de la compra en curso
      setLineMetaByProductId(new Map());
      return;
    }

    setLineMetaByProductId((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const product of catalog) {
        const meta: PurchaseLineItemMeta = {
          name: product.name,
          packUnits: product.packUnits,
          sku: product.sku,
          taxRate: product.taxRate,
        };
        const current = next.get(product.productId);
        if (
          !current ||
          current.name !== meta.name ||
          current.sku !== meta.sku ||
          current.packUnits !== meta.packUnits ||
          current.taxRate !== meta.taxRate
        ) {
          next.set(product.productId, meta);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [catalog, supplierId]);

  // Lineas con su alicuota resuelta y los costos sincronizados: la tabla, el
  // resumen y el payload salen de aqui para que no puedan desalinearse.
  const lines = useMemo(
    () =>
      withPurchaseLineDisassemble(
        buildPurchaseWebLines({
          getCategoryPct: (productId) => lineMetaByProductId.get(productId)?.taxRate ?? 0,
          items,
          rateVes: activeRateVes,
          locks,
          rates: taxRates.rates,
          review,
          taxState,
        }),
        disassemble,
        packProductIds,
        alwaysDisassembleProductIds,
      ),
    [
      activeRateVes,
      alwaysDisassembleProductIds,
      disassemble,
      items,
      lineMetaByProductId,
      locks,
      packProductIds,
      review,
      taxRates.rates,
      taxState,
    ],
  );
  // Revisión antes de confirmar: qué líneas se tocaron después de agregarlas y qué cambió.
  const editedLines = useMemo(
    () =>
      getEditedLinesSummary(
        lines,
        (productId) => lineMetaByProductId.get(productId)?.name ?? "Producto",
      ),
    [lineMetaByProductId, lines],
  );
  const totals = useMemo(
    () =>
      sumDraftPurchaseTotals(
        lines.map((line) => line.item),
        activeRateVes,
      ),
    [activeRateVes, lines],
  );
  const taxBreakdown = useMemo(
    () => buildPurchaseTaxBreakdown(lines, activeRateVes),
    [activeRateVes, lines],
  );
  const discountVes = roundMoney(refToVes(discountRef, activeRateVes));
  const totalVes = Math.max(0, roundMoney(totals.subtotalVes - discountVes + totals.taxVes));
  const paymentMethods = useMemo(
    () =>
      filterEnabledPaymentMethods(
        enabledPaymentMethodsQuery.data ?? DEFAULT_ENABLED_PAYMENT_METHODS,
      ),
    [enabledPaymentMethodsQuery.data],
  );
  // Si la tienda no tiene habilitado el método elegido se usa el primero habilitado,
  // convirtiendo el monto como en el cambio manual de método (igual que el modal de pago).
  const paymentValues = useMemo<PaymentFormValues>(() => {
    const [fallbackMethod] = paymentMethods;

    if (!fallbackMethod || paymentMethods.includes(storedPaymentValues.method)) {
      return storedPaymentValues;
    }

    return {
      ...storedPaymentValues,
      amount: amountForMethodChange(
        storedPaymentValues.method,
        fallbackMethod,
        storedPaymentValues.amount,
        activeRateVes,
      ),
      method: fallbackMethod,
    };
  }, [activeRateVes, paymentMethods, storedPaymentValues]);
  const validLines = lines.filter(({ item }) => {
    if (!item.productId) return false;
    if (item.entryMode === "pack") {
      return (
        item.packCount > 0 &&
        item.unitsPerPack > 0 &&
        item.packCostRef >= 0 &&
        item.packLabel.trim().length > 0 &&
        item.quantity > 0
      );
    }

    return item.quantity > 0 && item.unitCostRef >= 0;
  });

  const draftContent = useMemo<PurchaseDraftContent>(
    () => ({
      costCurrency,
      discountRef,
      ...(loadedScan
        ? {
            invoiceScan: toStoredInvoiceScan(
              pruneLoadedInvoiceScan(
                loadedScan,
                items.map((item) => item.id),
              ),
            ),
          }
        : {}),
      lineMeta: Object.fromEntries(
        items.flatMap((item) => {
          const meta = lineMetaByProductId.get(item.productId);

          return meta ? [[item.productId, meta]] : [];
        }),
      ),
      lines: { ...(disassemble ? { disassemble } : {}), items, locks, review, taxState },
      notes,
      rateVes: activeRateVes,
      status: status === "pedido" ? "pedido" : "recibido",
      supplierId,
      ...(supplierName ? { supplierName } : {}),
    }),
    [
      activeRateVes,
      costCurrency,
      disassemble,
      discountRef,
      items,
      lineMetaByProductId,
      loadedScan,
      locks,
      notes,
      review,
      status,
      supplierId,
      supplierName,
      taxState,
    ],
  );
  const hasPendingDraft = draft.pending !== null;
  const { saveBlock, schedule: scheduleDraft, sync: syncDraft } = draft;
  // Borrador restaurado cuyas líneas esperan otro proveedor: siguen en lo guardado, y el
  // formulario (aún sin ellas) no lo pisa hasta que entren.
  const draftLinesAwaitSupplier = pendingDuplicate?.fromDraft === true;

  // Guardado automático (CNF-16): cada cambio, tras 500 ms sin otro. Dónde escribe lo decide
  // el hook (nunca pisa un borrador sin decidir: con el aviso sin resolver, esta compra va a
  // una segunda ranura). Al restaurar, descartar o seguir con esta el efecto vuelve a correr.
  useEffect(() => {
    if (confirmed || draftLinesAwaitSupplier) {
      return;
    }

    scheduleDraft(draftContent);
  }, [confirmed, draftContent, draftLinesAwaitSupplier, hasPendingDraft, scheduleDraft]);

  // Regla 14 (CNF-15): con una línea o un proveedor elegido, salir pregunta nombrando la
  // compra. «Salir» guarda el borrador en el acto, sin esperar al guardado automático. Si
  // esta compra no tiene dónde guardarse no se promete: el aviso es de pérdida.
  // Un escaneo de factura en curso (SCN-07) también activa el guardia y le da nombre; si
  // además hay compra, salir sigue guardando (o avisando de perder) su borrador.
  const purchaseInProgress = (items.length > 0 || supplierId !== "") && !confirmed;
  const purchaseSaveDescription =
    saveBlock === "two-drafts"
      ? "Ya hay dos compras sin terminar guardadas: esta no se guardará mientras no restaures o descartes aquellas."
      : saveBlock === "storage"
        ? "Este navegador no dejó guardar el borrador (almacenamiento lleno o bloqueado): si sales, esta compra se pierde."
        : undefined;
  // La revisión de una factura leída (SCN-08c) también lo activa y le da nombre.
  const invoiceLeaveDescription = invoiceScanBusy
    ? INVOICE_SCAN_LEAVE_DESCRIPTION
    : reviewingInvoice
      ? INVOICE_REVIEW_LEAVE_DESCRIPTION
      : null;
  const guard = useProcessGuard({
    active: purchaseInProgress || invoiceScanBusy || reviewingInvoice,
    description: invoiceLeaveDescription
      ? [invoiceLeaveDescription, purchaseInProgress ? purchaseSaveDescription : undefined]
          .filter(Boolean)
          .join(" ")
      : purchaseSaveDescription,
    label: invoiceScanBusy
      ? INVOICE_SCAN_PROCESS_LABEL
      : reviewingInvoice
        ? INVOICE_REVIEW_PROCESS_LABEL
        : describePurchaseInProgress({
          lineCount: items.length,
          supplierId,
          supplierName,
          totalRef: Math.max(0, roundMoney(totals.subtotalRef - discountRef + totals.taxRef)),
        }),
    onLeave: purchaseInProgress && !saveBlock ? "draft" : "discard",
    onSaveDraft: () => syncDraft(draftContent),
  });

  /**
   * Costos al último conocido para `nextSupplier`. Devuelve la función que pone las
   * líneas en el formulario (sustituyen las que hubiera): quien llama decide cuándo.
   */
  async function prepareDuplicatedLines(
    nextSupplier: { id: string; name: string | null },
    sourceItems: PurchaseLineSource[],
  ) {
    // Como el buscador: el costo sugerido es el de la última compra recibida de cada producto.
    const products = await withLastPurchaseCosts(
      nextSupplier.id,
      await resolvePurchaseProducts(
        nextSupplier.id,
        sourceItems.map((item) => item.productId),
      ),
    );
    const duplicated = buildDuplicatedPurchaseLines(sourceItems, products, {
      costCurrency,
      nextId: nextPurchaseLineId,
      rateVes: activeRateVes,
    });

    return () => {
      setSupplierId(nextSupplier.id);
      setSupplierName(nextSupplier.name);
      setProductSearch("");
      setLineMetaByProductId(duplicated.lineMeta);
      dispatchLines({ state: duplicated.lines, type: "linesRestored" });
      setLoadedScan(null);
      setNotices(duplicated.notices);
      setPendingDuplicate(null);
    };
  }

  // No copia notas, descuento, pagos ni estado: solo proveedor y líneas.
  async function loadDuplicate(source: PurchaseDetails) {
    const sourceSupplier = source.supplier;
    const canBuyFromSupplier =
      sourceSupplier !== undefined &&
      sourceSupplier.isActive !== false &&
      (sourceSupplier.type === "proveedor" || sourceSupplier.type === "ambos");

    if (!canBuyFromSupplier) {
      return () =>
        setPendingDuplicate({
          fromDraft: false,
          items: source.items,
          notice: sourceSupplier?.name
            ? `El proveedor ${sourceSupplier.name} está inactivo: elige otro proveedor para duplicar la compra.`
            : "El proveedor de la compra original ya no está disponible: elige otro proveedor para duplicar la compra.",
        });
    }

    return prepareDuplicatedLines(
      { id: source.supplierId, name: sourceSupplier.name },
      source.items,
    );
  }

  const duplicate = usePurchaseDuplicateSource({
    load: loadDuplicate,
    ready: currentRateVes !== undefined,
  });

  /** Pone en el formulario las líneas de la reposición para `nextSupplier` (sustituyen las que hubiera). */
  async function loadRestockLines(
    restockDraft: RestockDraft,
    nextSupplier: { id: string; name: string | null },
  ) {
    const products = await withLastPurchaseCosts(
      nextSupplier.id,
      await resolvePurchaseProducts(
        nextSupplier.id,
        restockDraft.lines.map((line) => line.productId),
      ),
    );
    const built = buildRestockPurchaseLines(restockDraft.lines, products, {
      costCurrency,
      nextId: nextPurchaseLineId,
      rateVes: activeRateVes,
    });

    // Antes de que entren las líneas: el formulario (y su `ProcessGuard`) queda sobre la
    // URL limpia, y la precarga ya vive en el borrador de la compra (COM-09).
    consumeRestockDraft(restockDraft.id);
    setSupplierId(nextSupplier.id);
    setSupplierName(nextSupplier.name);
    setProductSearch("");
    setLineMetaByProductId(built.lineMeta);
    dispatchLines({ state: built.lines, type: "linesRestored" });
    setLoadedScan(null);
    setNotices([]);
    setPendingDuplicate(null);
    setPendingRestock(null);
    setFormError(null);

    if (built.omitted > 0) {
      showToast({ title: describeRestockOmitted(built.omitted), tone: "error" });
    }
  }

  /**
   * Precarga la reposición sobre una compra VACÍA. Con proveedor en el payload (y aún
   * activo) entran las líneas; sin él no se inventa: esperan a que se elija uno.
   */
  async function startRestock(restockDraft: RestockDraft) {
    setIsLoadingDuplicateLines(true);

    try {
      const supplier = restockDraft.supplier
        ? await fetchPurchaseSupplier(restockDraft.supplier.id)
        : null;

      if (restockDraft.supplier && !supplier?.isActive) {
        showToast({ title: "El proveedor de la reposición ya no está disponible", tone: "error" });
      }

      if (supplier?.isActive) {
        await loadRestockLines(restockDraft, { id: supplier.id, name: supplier.name });
      } else {
        setPendingRestock(restockDraft);
      }
    } catch (error) {
      showToast({
        description: errorMessage(error),
        title: "No pudimos cargar la reposición",
        tone: "error",
      });
    } finally {
      setIsLoadingDuplicateLines(false);
    }
  }

  // Compra en curso = líneas, proveedor elegido, una compra duplicada a medias o un
  // borrador guardado sin decidir (COM-09): la reposición no la pisa, pregunta.
  const hasPurchaseInProgress =
    items.length > 0 || supplierId !== "" || pendingDuplicate !== null || draft.pending !== null;
  usePurchaseRestockSource({
    onDraft: (restockDraft) => {
      if (hasPurchaseInProgress) {
        setRestockConflict(restockDraft);
        return;
      }

      void startRestock(restockDraft);
    },
    onUnavailable: () => showToast({ title: RESTOCK_UNAVAILABLE_MESSAGE, tone: "error" }),
    // Sin tasa no se pueden calcular las líneas; con una compra por duplicar manda esa.
    ready: currentRateVes !== undefined && !duplicate.isLoading,
  });

  /** «Reemplazar por la reposición»: vacía la compra en curso (y su borrador) y precarga. */
  function replaceWithRestock(restockDraft: RestockDraft) {
    // Otra compra: la clave del intento anterior (si falló) no viaja con esta.
    requestAttempt.discard();
    draft.clear();
    setSupplierId("");
    setSupplierName(null);
    setProductSearch("");
    setNotes("");
    setDiscountRef(0);
    setStatus("recibido");
    dispatchLines({ type: "supplierChanged" });
    setLineMetaByProductId(new Map());
    setLoadedScan(null);
    setNotices([]);
    setPendingDuplicate(null);
    setFormError(null);
    void startRestock(restockDraft);
  }

  // `saved`: el borrador guardado; `new`: la compra nueva de la segunda ranura (tras
  // recargar sin decidir). La que no se restaura se descarta.
  async function handleRestoreDraft(which: "new" | "saved") {
    const stored = which === "new" ? draft.pendingNew : draft.pending;

    if (!stored || currentRateVes === undefined) {
      return;
    }

    setIsRestoringDraft(true);

    try {
      // Se revalida contra lo que hay hoy: el proveedor y, si sigue sirviendo, cada producto.
      const supplier = stored.supplierId ? await fetchPurchaseSupplier(stored.supplierId) : null;
      const restored =
        stored.supplierId === "" || supplier?.isActive
          ? restorePurchaseDraft(stored, {
              products: await resolvePurchaseProducts(
                stored.supplierId,
                stored.lines.items.map((item) => item.productId),
              ),
              rateVes: currentRateVes,
              taxRates: taxRates.rates,
            })
          : null;

      if (which === "new") {
        draft.keepNew();
      } else {
        draft.adopt();
      }

      setProductSearch("");
      setStatus(stored.status);
      setNotes(stored.notes);
      setDiscountRef(stored.discountRef);
      setCostCurrency(stored.costCurrency);

      if (restored) {
        setSupplierId(stored.supplierId);
        setSupplierName(supplier?.name ?? stored.supplierName ?? null);
        setLineMetaByProductId(restored.lineMeta);
        dispatchLines({ state: restored.lines, type: "linesRestored" });
        setLoadedScan(restored.invoiceScan ?? null);
        setNotices(restored.notices);
        setPendingDuplicate(null);
      } else {
        // Proveedor inactivo o que ya no existe: no se elige, y las líneas (que son de ese
        // proveedor) esperan a otro como en una compra duplicada. Nunca en silencio.
        setSupplierId("");
        setSupplierName(null);
        setLineMetaByProductId(new Map());
        dispatchLines({ type: "supplierChanged" });
        setLoadedScan(null);
        setNotices([]);
        setPendingDuplicate({
          fromDraft: true,
          items: storedDraftSourceItems(stored),
          notice: describeDraftSupplierUnavailable(stored),
        });
      }

      // Restaurar una compra guardada sustituye a la reposición que esperaba proveedor.
      if (pendingRestock) {
        consumeRestockDraft(pendingRestock.id);
        setPendingRestock(null);
      }
      setFormError(null);
    } catch (error) {
      showToast({
        description: errorMessage(error),
        title: "No pudimos restaurar la compra",
        tone: "error",
      });
    } finally {
      setIsRestoringDraft(false);
    }
  }

  function getItemMeta(productId: string): PurchaseLineItemMeta {
    return (
      lineMetaByProductId.get(productId) ?? {
        name: "Producto",
        sku: "—",
        taxRate: 0,
      }
    );
  }

  // Cambiar o quitar el proveedor vacía las líneas (sus costos y vínculos son de ese
  // proveedor): con líneas se pregunta antes. Una compra duplicada cuyo proveedor está
  // inactivo aún no tiene líneas en el formulario, así que no pregunta.
  function handleSupplierChange(nextSupplierId: string, nextSupplierName?: string) {
    if (items.length > 0) {
      setSupplierChangeRequest({ id: nextSupplierId, name: nextSupplierName });
      return;
    }

    applySupplierChange(nextSupplierId, nextSupplierName);
  }

  function applySupplierChange(nextSupplierId: string, nextSupplierName?: string) {
    setSupplierId(nextSupplierId);
    setSupplierName(nextSupplierName ?? null);
    setProductSearch("");
    dispatchLines({ type: "supplierChanged" });
    setLineMetaByProductId(new Map());
    // Las líneas de la factura se fueron con el proveedor: el escaneo ya no viaja.
    setLoadedScan(null);

    // Reposición sin proveedor: sus líneas entran con el que se elija.
    if (pendingRestock && nextSupplierId) {
      setIsLoadingDuplicateLines(true);
      void loadRestockLines(pendingRestock, { id: nextSupplierId, name: nextSupplierName ?? null })
        .catch((error: unknown) => {
          showToast({
            description: errorMessage(error),
            title: "No pudimos cargar la reposición",
            tone: "error",
          });
        })
        .finally(() => setIsLoadingDuplicateLines(false));
      return;
    }

    // Compra duplicada de un proveedor inactivo: sus líneas entran con el que se elija.
    if (pendingDuplicate && nextSupplierId) {
      setIsLoadingDuplicateLines(true);
      void prepareDuplicatedLines(
        { id: nextSupplierId, name: nextSupplierName ?? null },
        pendingDuplicate.items,
      )
        .then((apply) => apply())
        .catch((error: unknown) => {
          showToast({
            description: errorMessage(error),
            title: "No pudimos cargar las líneas de la compra",
            tone: "error",
          });
        })
        .finally(() => setIsLoadingDuplicateLines(false));
    }
  }

  function handleCostCurrencyChange(nextCurrency: PurchaseCostCurrency) {
    setCostCurrency(nextCurrency);
    dispatchLines({ currency: nextCurrency, rateVes: activeRateVes, type: "costCurrencyChanged" });
  }

  // `scanned`: entró por el lector; el foco se queda en el buscador para encadenar (D36).
  function handleAddProduct(product: PurchaseCatalogProduct, options?: { scanned?: boolean }) {
    setLineMetaByProductId((prev) => {
      const next = new Map(prev);
      next.set(product.productId, {
        name: product.name,
        packUnits: product.packUnits,
        sku: product.sku,
        taxRate: product.taxRate,
      });
      return next;
    });

    dispatchLines({
      keepFocus: options?.scanned === true,
      line: buildPurchaseLine(product, {
        costCurrency,
        id: nextPurchaseLineId(),
        rateVes: activeRateVes,
      }),
      lockOthers: lockOnAdd,
      rateVes: activeRateVes,
      type: "productAdded",
    });
  }

  // El producto recién creado entra como cualquier otro sin vínculo: por unidad, con su
  // costo llevado a base sin IVA y la alícuota de su categoría.
  function handleProductCreated(product: ProductWithCategory) {
    handleAddProduct(buildUnlinkedCatalogProduct(product));
    setProductSearch("");
  }

  function handleUpdateItem(itemId: string, input: Partial<PurchaseDraftItem>) {
    dispatchLines({ input, itemId, rateVes: activeRateVes, type: "lineUpdated" });
  }

  function handleExemptPurchaseChange(exempt: boolean) {
    const overridden = exempt ? countManualLinesLostToExempt(lines, taxRates.rates) : 0;

    dispatchLines({ exempt, type: "exemptChanged" });

    if (overridden > 0) {
      showToast({ title: buildExemptOverrideNotice(overridden) });
    }
  }

  // Mismos helpers que pintan la tabla y el resumen: lo que se envia (y lo que
  // muestra la confirmación) es exactamente lo que el usuario vio.
  const submitTotals = sumDraftPurchaseTotals(
    validLines.map((line) => line.item),
    activeRateVes,
  );
  const submitTotalVes = Math.max(
    0,
    roundMoney(submitTotals.subtotalVes - discountVes + submitTotals.taxVes),
  );
  // Sección abierta = el usuario quiere pagar: incompleta o inválida no se envía nada.
  const initialPayment =
    canPayNow && payNow ? resolveInitialPayment(paymentValues, submitTotalVes, activeRateVes) : null;
  const confirmInput: PurchaseConfirmInput = {
    discountRef,
    getProductName: (productId) => getItemMeta(productId).name,
    lines: validLines,
    payment: initialPayment && "payment" in initialPayment ? initialPayment.payment : null,
    rateVes: activeRateVes,
    recipes: packConversions.data,
    status,
    supplierName,
  };

  // Una línea que cambia con la confirmación abierta (llegó un escaneo en cola, cambió
  // la tasa): el modal se cierra, nunca se confirman cifras que ya no son las de la compra.
  if (
    confirmKey !== null &&
    !createPurchase.isPending &&
    confirmKey !== purchaseConfirmKey(confirmInput)
  ) {
    setConfirmKey(null);
    setFormError(PURCHASE_CHANGED_MESSAGE);
  }

  /** Validaciones de «Confirmar Compra» y, si pasan, lo que se envía; `null` = queda un aviso. */
  function prepareSubmission() {
    if (!supplierId) {
      setFormError("Selecciona un proveedor antes de confirmar la compra.");
      return null;
    }

    if (invoiceRateMissing) {
      setFormError(INVOICE_RATE_MISSING_MESSAGE);
      return null;
    }

    if (validLines.length === 0) {
      setFormError("Agrega al menos un producto con cantidad y costo válidos.");
      return null;
    }

    if (lines.some((line) => line.tax.code === null)) {
      setFormError(LINE_TAX_MISSING_MESSAGE);
      return null;
    }

    setFormError(null);

    if (isPurchaseDiscountOverSubtotal(discountRef, submitTotals.subtotalRef)) {
      setFormError(PURCHASE_DISCOUNT_OVER_SUBTOTAL_MESSAGE);
      return null;
    }

    if (initialPayment && "error" in initialPayment) {
      setPaymentSubmitted(true);
      setPaymentError(initialPayment.error);
      return null;
    }

    setPaymentError(null);

    const input = {
      discountRef,
      discountVes,
      // `taxRateCode` y `taxRate` van juntos: la RPC valida que el porcentaje sea el de la alicuota.
      // `disassembleOnReceive` solo en las líneas marcadas de un producto con receta (COM-14).
      items: validLines.map((line) => ({
        ...draftToPurchaseItemInput(line.item, activeRateVes),
        ...(line.tax.code ? { taxRateCode: line.tax.code } : {}),
        ...purchaseLineDisassemblePayload(line),
      })),
      notes: notes.trim() || undefined,
      refRateVes: activeRateVes,
      // Escaneo cargado (SCN-08c): desde las líneas que se envían, con sus cifras finales.
      ...(loadedScan
        ? buildInvoiceScanSubmission(loadedScan, validLines, {
            costCurrency,
            taxRates: taxPctByCode,
          })
        : {}),
      status,
      subtotalRef: submitTotals.subtotalRef,
      subtotalVes: submitTotals.subtotalVes,
      supplierId,
      taxRef: submitTotals.taxRef,
      taxVes: submitTotals.taxVes,
    };

    return { initialPayment, input };
  }

  /** La factura leída abre su revisión en la página, en lugar del formulario. */
  function onInvoiceScanned(response: InvoiceScanResponse) {
    setScannedInvoice(response);
    setInvoiceScanOpen(false);
  }

  /**
   * «Cargar en la compra»: las líneas de la factura entran al formulario bloqueadas
   * (COM-12) con proveedor, moneda y, en las notas vacías, número y fecha de la factura.
   * `replace`: sustituyen a la compra en curso (que era de otro proveedor).
   */
  async function loadInvoiceDraft(reviewDraft: InvoiceReviewDraft, replace: boolean) {
    if (invoiceLoadingRef.current) {
      return;
    }

    invoiceLoadingRef.current = true;
    setIsLoadingInvoice(true);

    try {
      const nextSupplierId = reviewDraft.supplier.contactId;
      // Nombre, SKU, empaques y % de categoría del catálogo actual, como al restaurar.
      const products = await resolvePurchaseProducts(
        nextSupplierId,
        reviewDraft.lines.map((line) => line.productId),
      );
      const applied = applyInvoiceReviewDraft(reviewDraft, {
        current: { ...(disassemble ? { disassemble } : {}), items, locks, review, taxState },
        currentCurrency: costCurrency,
        lockExisting: lockOnAdd,
        nextId: nextPurchaseLineId,
        products,
        // Aún no es la del formulario: sin tasa del día, la de esta factura.
        rateVes: currentRateVes ?? reviewDraft.invoiceRateVes ?? reviewDraft.rateVes ?? FALLBACK_RATE_VES,
        replace,
      });
      const keptNotes = replace ? "" : notes;
      const invoiceNote = describeInvoiceForNotes(reviewDraft);

      if (replace) {
        // Otra compra: la clave del intento anterior (si falló) no viaja con esta.
        requestAttempt.discard();
        setDiscountRef(0);
        setStatus("recibido");
      }

      setNotes(keptNotes.trim() || !invoiceNote ? keptNotes : invoiceNote);
      setSupplierId(nextSupplierId);
      setSupplierName(reviewDraft.supplier.name);
      setProductSearch("");
      setCostCurrency(applied.costCurrency);
      setLineMetaByProductId((prev) => {
        const next = new Map(replace ? [] : prev);

        for (const [productId, meta] of applied.lineMeta) {
          next.set(productId, meta);
        }
        return next;
      });
      dispatchLines({ state: applied.lines, type: "linesRestored" });
      setLoadedScan(applied.loaded);
      setNotices((current) => (replace ? applied.notices : [...current, ...applied.notices]));
      setPendingDuplicate(null);

      // Como restaurar: la factura sustituye a la reposición que esperaba proveedor.
      if (pendingRestock) {
        consumeRestockDraft(pendingRestock.id);
        setPendingRestock(null);
      }
      setFormError(null);
      setScannedInvoice(null);
    } catch (error) {
      showToast({
        description: requestErrorMessage(error),
        title: "No pudimos cargar la factura en la compra",
        tone: "error",
      });
    } finally {
      invoiceLoadingRef.current = false;
      setIsLoadingInvoice(false);
    }
  }

  // Con líneas de OTRO proveedor se pregunta antes: sus costos y vínculos no sirven a este.
  function handleInvoiceLoad(reviewDraft: InvoiceReviewDraft) {
    if (items.length > 0 && supplierId !== reviewDraft.supplier.contactId) {
      setInvoiceReplaceRequest(reviewDraft);
      return;
    }

    void loadInvoiceDraft(reviewDraft, false);
  }

  /** Descarta el escaneo en el servidor y vuelve al formulario tal como estaba. */
  function discardScannedInvoice(response: InvoiceScanResponse) {
    setScannedInvoice(null);
    void apiFetch(`/api/purchases/invoice-scan/${encodeURIComponent(response.scanId)}/discard`, {
      method: "POST",
    }).catch((error: unknown) => {
      showToast({
        description: requestErrorMessage(error),
        title: "No pudimos descartar el escaneo",
        tone: "error",
      });
    });
  }

  // Lector con la confirmación abierta (CNF-F5): su Enter no llega al botón del modal. Como
  // cualquier línea que llega con el modal abierto, lo cierra: el código se resuelve en la
  // cola de escaneos y, si entra, hay que volver a confirmar.
  function handleConfirmScan(candidates: string[] | null) {
    if (createPurchase.isPending || !candidates) {
      showToast({
        description: createPurchase.isPending
          ? "La compra se está registrando: lo escaneado no se agregó."
          : "Cierra la confirmación para escanear o buscar productos.",
        title: "Lectura del escáner ignorada",
        tone: "error",
      });
      return;
    }

    // El modal se retira antes de encolar: el foco pasa al buscador y ahí debe quedarse.
    flushSync(() => setConfirmKey(null));
    pickerRef.current?.scan({
      candidates,
      onResolved: (code) => {
        if (code !== null) {
          setFormError(PURCHASE_CHANGED_MESSAGE);
        }
      },
    });
  }

  // «Confirmar Compra»: las validaciones van antes; con el formulario inválido el modal no se abre.
  function handleReview() {
    setConfirmAttempt((attempt) => attempt + 1);

    if (prepareSubmission()) {
      setConfirmKey(purchaseConfirmKey(confirmInput));
    }
  }

  // Botón del modal: envía la compra tal como el modal la mostró.
  async function handleSubmit() {
    const submission = prepareSubmission();

    if (!submission) {
      setConfirmKey(null);
      return;
    }

    const { initialPayment, input } = submission;
    // Clave de idempotencia del intento; null = hay un envío en vuelo (doble clic) o la
    // compra ya se confirmó y la página espera a que la navegación la desmonte.
    // El pago forma parte de la huella: si cambia tras un fallo, cambian las dos claves.
    const clientRequestId = requestAttempt.begin({
      ...input,
      initialPayment: initialPayment?.payment ?? null,
    });

    if (!clientRequestId) {
      return;
    }

    try {
      const purchase = await createPurchase.mutateAsync({
        ...input,
        clientRequestId,
        ...(initialPayment
          ? {
              initialPayment: {
                ...initialPayment.payment,
                clientRequestId: initialPaymentKey.for(clientRequestId),
              },
            }
          : {}),
      });

      requestAttempt.succeed();
      // La compra ya existe: el borrador sobra y salir no debe preguntar.
      setConfirmed(true);
      setConfirmKey(null);
      setLoadedScan(null);
      draft.clear();

      const learned = purchase.invoiceScan?.learned;

      if (learned) {
        showToast({ title: describeLearnedAliases(learned) });
      }

      // La compra existe aunque el pago no haya entrado: se sale del formulario igual
      // (quedarse invitaría a crear otra) y el detalle ofrece registrar el pago.
      if (purchase.initialPayment?.status === "failed") {
        showToast({
          ...buildInitialPaymentFailedNotice(purchase.initialPayment.message),
          tone: "error",
        });
      }
      guard.runUnguarded(() => router.push(`/purchases/${purchase.id}`));
    } catch (error) {
      // Error surfaced via createPurchase.error
      requestAttempt.fail(error);
    }
  }

  const dependencyError = exchangeRate.error ?? taxRates.error;
  const shownPaymentError = canPayNow && payNow ? paymentError : null;
  // Un solo motivo junto al botón: la validación propia, el pago incompleto o lo que
  // contestó (o no) el servidor al último envío.
  const submitError = createPurchase.error ? describeConfirmError(createPurchase.error) : null;
  // Con la confirmación abierta, lo que contestó el servidor se lee en el modal.
  const confirmError = formError ?? shownPaymentError ?? (confirmKey === null ? submitError : null);

  // Sin tasa la compra de origen no puede llegar al formulario: no se espera para siempre.
  const duplicateError = duplicate.error ?? (duplicate.isLoading ? exchangeRate.error : null);

  if (duplicateError || duplicate.isLoading) {
    return (
      <div className="space-y-6 pb-8">
        <PurchaseCreateHeader />
        {duplicateError ? (
          <ErrorState
            actionLabel="Volver a Compras"
            description={duplicateError.message}
            onRetry={() => guard.guardedNavigate("/purchases")}
            title="No pudimos duplicar la compra"
          />
        ) : (
          <LoadingState title="Cargando la compra a duplicar..." />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-8">
      <PurchaseCreateHeader
        onScanInvoice={
          canScanInvoice && !reviewingInvoice ? () => setInvoiceScanOpen(true) : undefined
        }
      />

      {scannedInvoice ? (
        <>
          {isLoadingInvoice ? (
            <LoadingState title="Cargando la factura en la compra..." variant="inline" />
          ) : null}
          <InvoiceReviewPanel
            canCreateProduct={canCreateProduct}
            context={reviewContext}
            key={scannedInvoice.scanId}
            onDiscard={() => discardScannedInvoice(scannedInvoice)}
            onLoad={handleInvoiceLoad}
            onRescan={() => {
              discardScannedInvoice(scannedInvoice);
              setInvoiceScanOpen(true);
            }}
            response={scannedInvoice}
          />
        </>
      ) : (
      <>
      {draft.pending ? (
        <PurchaseDraftBanner
          draft={draft.pending}
          isRestoring={isRestoringDraft}
          newDraft={draft.pendingNew}
          newDraftInForm={draft.ownsNew}
          onDiscard={draft.clear}
          onKeepNew={draft.keepNew}
          onRestore={() => void handleRestoreDraft("saved")}
          onRestoreNew={() => void handleRestoreDraft("new")}
          replacesForm={items.length > 0 || pendingDuplicate !== null}
          restoreDisabled={currentRateVes === undefined}
        />
      ) : null}

      {pendingDuplicate ? <PurchaseFormNotices messages={[pendingDuplicate.notice]} /> : null}

      {pendingRestock ? (
        <PurchaseFormNotices
          messages={[describeRestockAwaitingSupplier(pendingRestock.lines.length)]}
        />
      ) : null}

      {isLoadingDuplicateLines ? (
        <LoadingState title="Cargando las líneas de la compra..." variant="inline" />
      ) : null}

      <PurchaseFormNotices messages={notices} onDismiss={() => setNotices([])} />

      {dependencyError ? (
        <ErrorState
          description={dependencyError.message}
          title="No pudimos cargar los datos de la compra"
        />
      ) : null}

      {/* Dos columnas solo si además caben: `lg:` mide la ventana en px y no se entera de
          una fuente al 130 %; `@xl` mide este bloque en rem. A 1024 px con fuente grande la
          columna lateral quedaba en ~110 px y cortaba «Método» de «Pagar ahora» (F5). */}
      <div className="@container">
      <div className="grid gap-6 lg:@xl:grid-cols-12 lg:@xl:items-start">
        <div className="flex min-w-0 flex-col gap-6 lg:@xl:col-span-8">
          <PurchaseSupplierCard
            onSupplierChange={handleSupplierChange}
            selectedSupplierId={supplierId}
          />
          <PurchaseProductPickerCard
            catalog={catalog}
            exemptDisabled={!findExemptTaxRate(taxRates.rates)}
            exemptPurchase={taxState.exempt}
            focusRequest={focus}
            getItemMeta={getItemMeta}
            isSearching={productSearchResult.isSearching}
            lines={lines}
            lockControls={{
              lockOnAdd,
              onLockAll: () => dispatchLines({ type: "allLinesLocked" }),
              onLockOnAddChange: setLockOnAdd,
              onToggleLine: (itemId, locked) =>
                dispatchLines({ itemId, locked, type: "lineLockChanged" }),
              onUnlockAll: () => dispatchLines({ type: "allLinesUnlocked" }),
            }}
            onAddProduct={handleAddProduct}
            onExemptPurchaseChange={handleExemptPurchaseChange}
            onLineDisassembleChange={(itemId, nextDisassemble) =>
              dispatchLines({ disassemble: nextDisassemble, itemId, type: "lineDisassembleChanged" })
            }
            onLineTaxChange={(itemId, code) =>
              dispatchLines({ code, itemId, type: "lineTaxChosen" })
            }
            onNewProduct={
              canCreateProduct
                ? (initialValues, opener) => {
                    newProductOpenerRef.current = opener;
                    setNewProductValues(initialValues);
                  }
                : undefined
            }
            onRemoveItem={(itemId) => dispatchLines({ itemId, type: "lineRemoved" })}
            onScanMissed={(missed) =>
              showToast({
                description: missed.message,
                title:
                  "productName" in missed
                    ? `No se agregó ${missed.productName}`
                    : `No se agregó el código ${missed.code}`,
                tone: "error",
              })
            }
            onSearchChange={setProductSearch}
            onSettleItem={(itemId) => dispatchLines({ itemId, type: "lineSettled" })}
            onUpdateItem={handleUpdateItem}
            rateVes={activeRateVes}
            ref={pickerRef}
            search={productSearch}
            searchError={productSearchResult.error?.message ?? null}
            supplierId={supplierId}
            taxCatalog={taxRates}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-6 lg:@xl:sticky lg:@xl:top-6 lg:@xl:col-span-4">
          <PurchaseStatusNotesCard
            notes={notes}
            onNotesChange={setNotes}
            onStatusChange={setStatus}
            status={status}
          />
          {canPayNow ? (
            <PurchasePaymentSection
              error={shownPaymentError}
              methods={paymentMethods}
              onOpenChange={(open) => {
                setPayNow(open);
                setPaymentError(null);
              }}
              onValuesChange={(values) => {
                setPaymentValues(values);
                setPaymentError(null);
              }}
              open={payNow}
              rateVes={activeRateVes}
              showErrors={paymentSubmitted}
              totalVes={totalVes}
              values={paymentValues}
            />
          ) : null}
          <PurchaseSummaryCard
            confirmError={confirmError}
            confirmErrorAnnounced={confirmError !== null && confirmError === shownPaymentError}
            confirmErrorAttempt={confirmAttempt}
            costCurrency={costCurrency}
            discountRef={discountRef}
            discountVes={discountVes}
            editedLines={editedLines}
            isConfirmed={confirmed}
            isSubmitting={createPurchase.isPending}
            onConfirm={handleReview}
            onCostCurrencyChange={handleCostCurrencyChange}
            onDiscountChange={setDiscountRef}
            onDiscountScan={(scan) => pickerRef.current?.scan(scan)}
            subtotalRef={totals.subtotalRef}
            subtotalVes={totals.subtotalVes}
            taxBreakdown={taxBreakdown}
            taxRef={totals.taxRef}
            taxVes={totals.taxVes}
          />
        </div>
      </div>
      </div>
      </>
      )}

      {canCreateProduct ? (
        <PurchaseNewProductModal
          initialValues={newProductValues ?? undefined}
          onCreated={handleProductCreated}
          onOpenChange={(open) => {
            if (!open) {
              setNewProductValues(null);
            }
          }}
          open={newProductValues !== null}
          returnFocusTo={newProductOpenerRef}
        />
      ) : null}
      <PurchaseConfirmModal
        error={submitError}
        input={confirmInput}
        isPending={createPurchase.isPending}
        onConfirm={handleSubmit}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmKey(null);
          }
        }}
        onScan={handleConfirmScan}
        open={confirmKey !== null}
        supplierId={supplierId}
      />
      <ConfirmActionModal
        confirmLabel="Quitar líneas y cambiar"
        description={
          items.length === 1
            ? "Cambiar de proveedor quita la línea de esta compra."
            : `Cambiar de proveedor quita las ${items.length} líneas de esta compra.`
        }
        onConfirm={() => {
          if (supplierChangeRequest) {
            applySupplierChange(supplierChangeRequest.id, supplierChangeRequest.name);
          }

          setSupplierChangeRequest(null);
        }}
        onOpenChange={(open) => {
          if (!open) {
            setSupplierChangeRequest(null);
          }
        }}
        open={supplierChangeRequest !== null}
        title="Cambiar de proveedor"
        variant="danger"
      />
      <ConfirmActionModal
        cancelLabel="Conservar la compra actual"
        confirmLabel="Reemplazar por la reposición"
        description={
          restockConflict
            ? `Ya hay una compra sin terminar. Reemplazarla la descarta, junto con su borrador guardado, y carga ${
                restockConflict.lines.length === 1
                  ? "el producto"
                  : `los ${restockConflict.lines.length} productos`
              } de la reposición. Si la conservas, la reposición se descarta.`
            : ""
        }
        onConfirm={() => {
          if (restockConflict) {
            replaceWithRestock(restockConflict);
          }

          setRestockConflict(null);
        }}
        onOpenChange={(open) => {
          // Cerrar sin elegir = conservar: la compra actual no se toca y la reposición se consume.
          if (!open && restockConflict) {
            consumeRestockDraft(restockConflict.id);
            setRestockConflict(null);
          }
        }}
        open={restockConflict !== null}
        title="Tienes una compra en curso"
        variant="danger"
      />
      <ConfirmActionModal
        cancelLabel="Cancelar"
        confirmLabel="Reemplazar la compra"
        description={
          invoiceReplaceRequest
            ? `La factura es de ${invoiceReplaceRequest.supplier.name} y la compra en curso es de otro proveedor. Reemplazarla quita ${
                items.length === 1 ? "su línea" : `sus ${items.length} líneas`
              }, notas y descuento, y carga las de la factura.`
            : ""
        }
        onConfirm={() => {
          if (invoiceReplaceRequest) {
            void loadInvoiceDraft(invoiceReplaceRequest, true);
          }

          setInvoiceReplaceRequest(null);
        }}
        onOpenChange={(open) => {
          if (!open) {
            setInvoiceReplaceRequest(null);
          }
        }}
        open={invoiceReplaceRequest !== null}
        title="Reemplazar la compra en curso"
        variant="danger"
      />
      {canScanInvoice && invoiceScanOpen ? (
        <InvoiceScanModal
          onBusyChange={setInvoiceScanBusy}
          onOpenChange={setInvoiceScanOpen}
          onScanned={onInvoiceScanned}
          open
          supplierId={supplierId || undefined}
        />
      ) : null}
      <ProcessGuardModal guard={guard} />
    </div>
  );
}
