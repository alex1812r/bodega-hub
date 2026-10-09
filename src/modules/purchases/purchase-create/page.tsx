"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import type { RestockDraft } from "@/modules/inventory/restock";
import type { ProductWithCategory } from "@/modules/products/hooks/useProducts";
import type { ProductFormInitialValues } from "@/modules/products/product-details/components/ProductFormModal";
import { useCurrentExchangeRate } from "@/modules/settings/hooks/useCurrentExchangeRate";
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

const LINE_TAX_MISSING_MESSAGE = "Elige una alícuota en cada línea antes de confirmar la compra.";

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

export function PurchaseCreatePage() {
  const router = useRouter();
  const exchangeRate = useCurrentExchangeRate();
  const createPurchase = useCreatePurchase();
  // Cerrojo de «Confirmar Compra»: una clave por intento y ninguna tras confirmarla.
  const [requestAttempt] = useState(() => new PurchaseSubmitAttempt());
  // Clave del pago inicial: una por intento de compra, ligada a la clave de este.
  const [initialPaymentKey] = useState(() => new InitialPaymentKey());
  const { showToast } = useToast();
  const { can } = usePermission();
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
  const productSearchResult = usePurchaseProductSearch(supplierId, productSearch);
  const catalog = productSearchResult.catalog;
  const currentRateVes = exchangeRate.data?.rateVes;
  const activeRateVes = currentRateVes ?? 510;

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
  const guard = useProcessGuard({
    active: (items.length > 0 || supplierId !== "") && !confirmed,
    description:
      saveBlock === "two-drafts"
        ? "Ya hay dos compras sin terminar guardadas: esta no se guardará mientras no restaures o descartes aquellas."
        : saveBlock === "storage"
          ? "Este navegador no dejó guardar el borrador (almacenamiento lleno o bloqueado): si sales, esta compra se pierde."
          : undefined,
    label: describePurchaseInProgress({
      lineCount: items.length,
      supplierId,
      supplierName,
      totalRef: Math.max(0, roundMoney(totals.subtotalRef - discountRef + totals.taxRef)),
    }),
    onLeave: saveBlock ? "discard" : "draft",
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
        setNotices(restored.notices);
        setPendingDuplicate(null);
      } else {
        // Proveedor inactivo o que ya no existe: no se elige, y las líneas (que son de ese
        // proveedor) esperan a otro como en una compra duplicada. Nunca en silencio.
        setSupplierId("");
        setSupplierName(null);
        setLineMetaByProductId(new Map());
        dispatchLines({ type: "supplierChanged" });
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
      status,
      subtotalRef: submitTotals.subtotalRef,
      subtotalVes: submitTotals.subtotalVes,
      supplierId,
      taxRef: submitTotals.taxRef,
      taxVes: submitTotals.taxVes,
    };

    return { initialPayment, input };
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
      draft.clear();

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
      <PurchaseCreateHeader />

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

      <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-8">
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

        <div className="flex min-w-0 flex-col gap-6 lg:col-span-4 lg:sticky lg:top-6">
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
      <ProcessGuardModal guard={guard} />
    </div>
  );
}
