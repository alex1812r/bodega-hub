"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { useRequestAttempt } from "@/modules/inventory/utils/requestAttempt";
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

import { PurchaseCreateHeader } from "./components/PurchaseCreateHeader";
import { PurchaseDraftBanner } from "./components/PurchaseDraftBanner";
import { PurchaseFormNotices } from "./components/PurchaseFormNotices";
import { PurchaseNewProductModal } from "./components/PurchaseNewProductModal";
import { PurchasePaymentSection } from "./components/PurchasePaymentSection";
import {
  PurchaseProductPickerCard,
  type PurchaseCatalogProduct,
} from "./components/PurchaseProductPickerCard";
import { usePurchaseDraftStorage } from "./hooks/usePurchaseDraftStorage";
import { usePurchaseDuplicateSource } from "./hooks/usePurchaseDuplicateSource";
import { usePurchaseLines } from "./hooks/usePurchaseLines";
import { usePurchaseLockOnAdd } from "./hooks/usePurchaseLockOnAdd";
import { usePurchasePackConversions } from "./hooks/usePurchasePackConversions";
import { usePurchasePaymentMethods } from "./hooks/usePurchasePaymentMethods";
import { usePurchaseProductSearch } from "./hooks/usePurchaseProductSearch";
import { PurchaseStatusNotesCard } from "./components/PurchaseStatusNotesCard";
import { PurchaseSummaryCard } from "./components/PurchaseSummaryCard";
import { PurchaseSupplierCard } from "./components/PurchaseSupplierCard";
import type { PurchaseLineItemMeta } from "./components/PurchaseLineItemsTable";
import { useCreatePurchase, type PurchaseDetails } from "../hooks/usePurchases";
import { resolvePurchaseProducts } from "./services/resolvePurchaseProducts";
import type { PurchaseCostCurrency, PurchaseDraftItem } from "./types";
import { buildUnlinkedCatalogProduct } from "./utils/buildPurchaseCatalog";
import { buildPurchaseLine, nextPurchaseLineId } from "./utils/buildPurchaseLine";
import {
  buildDuplicatedPurchaseLines,
  type PurchaseDuplicateSourceItem,
} from "./utils/duplicatePurchase";
import { draftToPurchaseItemInput, sumDraftPurchaseTotals } from "./utils/normalizePurchaseLine";
import {
  restorePurchaseDraft,
  type PurchaseDraftContent,
} from "./utils/purchaseDraftStorage";
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
  buildExemptOverrideNotice,
  buildPurchaseTaxBreakdown,
  buildPurchaseWebLines,
  countManualLinesLostToExempt,
  findExemptTaxRate,
} from "./utils/purchaseLineTax";

const LINE_TAX_MISSING_MESSAGE = "Elige una alícuota en cada línea antes de confirmar la compra.";

/** Compra de origen cuyo proveedor ya no sirve: sus líneas esperan a que se elija otro. */
type PendingDuplicate = {
  items: PurchaseDuplicateSourceItem[];
  supplierName: string | null;
};

function describeLineCount(count: number) {
  return count === 1 ? "1 línea" : `${count} líneas`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : undefined;
}

export function PurchaseCreatePage() {
  const router = useRouter();
  const exchangeRate = useCurrentExchangeRate();
  const createPurchase = useCreatePurchase();
  const requestAttempt = useRequestAttempt();
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
  // Proveedor pedido (o `id: ""` = quitarlo) con líneas en la compra: espera la confirmación.
  const [supplierChangeRequest, setSupplierChangeRequest] = useState<{
    id: string;
    name?: string;
  } | null>(null);
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
  const syncDraft = draft.sync;

  // Se guarda en cada cambio. Con un borrador anterior sin decidir no se escribe:
  // al restaurarlo o descartarlo el efecto vuelve a correr y guarda lo que haya.
  useEffect(() => {
    if (confirmed || hasPendingDraft) {
      return;
    }

    syncDraft(draftContent);
  }, [confirmed, draftContent, hasPendingDraft, syncDraft]);

  // Regla 14: con líneas, salir pregunta. Si hay un borrador anterior sin decidir no se
  // promete guardar este (no se pisa aquel sin preguntar): el aviso es de pérdida.
  const guard = useProcessGuard({
    active: items.length > 0 && !confirmed,
    description: hasPendingDraft
      ? "Ya hay otra compra sin terminar guardada: esta no se guardará mientras no restaures o descartes aquella."
      : undefined,
    label: `Compra en curso con ${describeLineCount(items.length)}`,
    onLeave: hasPendingDraft ? "discard" : "draft",
    onSaveDraft: () => syncDraft(draftContent),
  });

  /**
   * Costos al último conocido para `nextSupplier`. Devuelve la función que pone las
   * líneas en el formulario (sustituyen las que hubiera): quien llama decide cuándo.
   */
  async function prepareDuplicatedLines(
    nextSupplier: { id: string; name: string | null },
    sourceItems: PurchaseDuplicateSourceItem[],
  ) {
    const products = await resolvePurchaseProducts(
      nextSupplier.id,
      sourceItems.map((item) => item.productId),
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
        setPendingDuplicate({ items: source.items, supplierName: sourceSupplier?.name ?? null });
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

  async function handleRestoreDraft() {
    const stored = draft.pending;

    if (!stored || currentRateVes === undefined) {
      return;
    }

    setIsRestoringDraft(true);

    try {
      const products = await resolvePurchaseProducts(
        stored.supplierId,
        stored.lines.items.map((item) => item.productId),
      );
      const restored = restorePurchaseDraft(stored, { products, rateVes: currentRateVes });

      draft.adopt();
      setSupplierId(stored.supplierId);
      setSupplierName(stored.supplierName ?? null);
      setProductSearch("");
      setStatus(stored.status);
      setNotes(stored.notes);
      setDiscountRef(stored.discountRef);
      setCostCurrency(restored.costCurrency);
      setLineMetaByProductId(restored.lineMeta);
      dispatchLines({ state: restored.lines, type: "linesRestored" });
      setNotices(restored.notices);
      setPendingDuplicate(null);
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

  async function handleSubmit() {
    if (!supplierId) {
      setFormError("Selecciona un proveedor antes de confirmar la compra.");
      return;
    }

    if (validLines.length === 0) {
      setFormError("Agrega al menos un producto con cantidad y costo validos.");
      return;
    }

    if (lines.some((line) => line.tax.code === null)) {
      setFormError(LINE_TAX_MISSING_MESSAGE);
      return;
    }

    setFormError(null);

    // Mismos helpers que pintan la tabla y el resumen: lo que se envia es
    // exactamente lo que el usuario vio.
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
      canPayNow && payNow
        ? resolveInitialPayment(paymentValues, submitTotalVes, activeRateVes)
        : null;

    if (initialPayment && "error" in initialPayment) {
      setPaymentSubmitted(true);
      setPaymentError(initialPayment.error);
      return;
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
    // Clave de idempotencia del intento; null = ya hay un envio en vuelo (doble clic).
    // El pago forma parte de la huella: si cambia tras un rechazo, cambian las dos claves.
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
            onRetry={() => router.push("/purchases")}
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
          onDiscard={draft.clear}
          onRestore={() => void handleRestoreDraft()}
          replacesForm={items.length > 0 || pendingDuplicate !== null}
          restoreDisabled={currentRateVes === undefined}
        />
      ) : null}

      {pendingDuplicate ? (
        <PurchaseFormNotices
          messages={[
            pendingDuplicate.supplierName
              ? `El proveedor ${pendingDuplicate.supplierName} está inactivo: elige otro proveedor para duplicar la compra.`
              : "El proveedor de la compra original ya no está disponible: elige otro proveedor para duplicar la compra.",
          ]}
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

      {formError || createPurchase.error ? (
        <ErrorState
          description={formError ?? createPurchase.error?.message}
          title="No pudimos registrar la compra"
        />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
        <div className="flex flex-col gap-6 lg:col-span-8">
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
            onScanMissed={({ code, message }) =>
              showToast({
                description: message,
                title: `No se agregó el código ${code}`,
                tone: "error",
              })
            }
            onSearchChange={setProductSearch}
            onSettleItem={(itemId) => dispatchLines({ itemId, type: "lineSettled" })}
            onUpdateItem={handleUpdateItem}
            rateVes={activeRateVes}
            search={productSearch}
            searchError={productSearchResult.error?.message ?? null}
            supplierId={supplierId}
            taxCatalog={taxRates}
          />
        </div>

        <div className="flex flex-col gap-6 lg:col-span-4 lg:sticky lg:top-6">
          <PurchaseStatusNotesCard
            notes={notes}
            onNotesChange={setNotes}
            onStatusChange={setStatus}
            status={status}
          />
          {canPayNow ? (
            <PurchasePaymentSection
              error={payNow ? paymentError : null}
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
            costCurrency={costCurrency}
            discountRef={discountRef}
            discountVes={discountVes}
            editedLines={editedLines}
            isSubmitting={createPurchase.isPending}
            onConfirm={() => void handleSubmit()}
            onCostCurrencyChange={handleCostCurrencyChange}
            onDiscountChange={setDiscountRef}
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
      <ProcessGuardModal guard={guard} />
    </div>
  );
}
