"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { getPaginatedItems } from "@/lib/api/pagination";
import { useContacts } from "@/modules/contacts/hooks/useContacts";
import { useRequestAttempt } from "@/modules/inventory/utils/requestAttempt";
import { useCurrentExchangeRate } from "@/modules/settings/hooks/useCurrentExchangeRate";
import { ErrorState } from "@/shared/components/ErrorState";
import { useToast } from "@/shared/components/Toast";
import { useTaxRates } from "@/shared/hooks/useTaxRates";
import type { PurchaseStatus } from "@/shared/mocks/erp-data";
import { refToVes, roundMoney } from "@/shared/utils/currency";

import { PurchaseCreateHeader } from "./components/PurchaseCreateHeader";
import {
  PurchaseProductPickerCard,
  type PurchaseCatalogProduct,
} from "./components/PurchaseProductPickerCard";
import { usePurchaseLines } from "./hooks/usePurchaseLines";
import { usePurchaseProductSearch } from "./hooks/usePurchaseProductSearch";
import { PurchaseStatusNotesCard } from "./components/PurchaseStatusNotesCard";
import { PurchaseSummaryCard } from "./components/PurchaseSummaryCard";
import { PurchaseSupplierCard } from "./components/PurchaseSupplierCard";
import type { PurchaseLineItemMeta } from "./components/PurchaseLineItemsTable";
import { useCreatePurchase } from "../hooks/usePurchases";
import type { PurchaseCostCurrency, PurchaseDraftItem } from "./types";
import { buildPurchaseLine, nextPurchaseLineId } from "./utils/buildPurchaseLine";
import { draftToPurchaseItemInput, sumDraftPurchaseTotals } from "./utils/normalizePurchaseLine";
import { getEditedLinesSummary } from "./utils/purchaseLineReview";
import {
  buildExemptOverrideNotice,
  buildPurchaseTaxBreakdown,
  buildPurchaseWebLines,
  countManualLinesLostToExempt,
  findExemptTaxRate,
} from "./utils/purchaseLineTax";

const LINE_TAX_MISSING_MESSAGE = "Elige una alícuota en cada línea antes de confirmar la compra.";

export function PurchaseCreatePage() {
  const router = useRouter();
  const suppliersQuery = useContacts({ limit: 100, type: "proveedor" });
  const exchangeRate = useCurrentExchangeRate();
  const createPurchase = useCreatePurchase();
  const requestAttempt = useRequestAttempt();
  const { showToast } = useToast();
  // Catálogo completo: los chips muestran también una alícuota desactivada.
  const taxRates = useTaxRates({ activeOnly: false });
  const [supplierId, setSupplierId] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [status, setStatus] = useState<PurchaseStatus>("recibido");
  const [notes, setNotes] = useState("");
  const [discountRef, setDiscountRef] = useState(0);
  // `items` es el borrador de core. Su `taxRate` NO es la fuente de verdad: la alícuota de
  // cada línea se deriva de `taxState` en `lines`, que es lo que se pinta y se envía.
  const [{ items, review, taxState }, dispatchLines] = usePurchaseLines();
  // Moneda en la que se teclean los costos: una sola para toda la compra.
  const [costCurrency, setCostCurrency] = useState<PurchaseCostCurrency>("ves");
  const [formError, setFormError] = useState<string | null>(null);
  const [lineMetaByProductId, setLineMetaByProductId] = useState(
    () => new Map<string, PurchaseLineItemMeta>(),
  );
  const productSearchResult = usePurchaseProductSearch(supplierId, productSearch);
  const catalog = productSearchResult.catalog;
  const activeRateVes = exchangeRate.data?.rateVes ?? 510;

  const suppliers = useMemo(
    () =>
      getPaginatedItems(suppliersQuery.data).filter(
        (contact) => contact.type === "proveedor" || contact.type === "ambos",
      ),
    [suppliersQuery.data],
  );

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
      buildPurchaseWebLines({
        getCategoryPct: (productId) => lineMetaByProductId.get(productId)?.taxRate ?? 0,
        items,
        rateVes: activeRateVes,
        rates: taxRates.rates,
        review,
        taxState,
      }),
    [activeRateVes, items, lineMetaByProductId, review, taxRates.rates, taxState],
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

  function getItemMeta(productId: string): PurchaseLineItemMeta {
    return (
      lineMetaByProductId.get(productId) ?? {
        name: "Producto",
        sku: "—",
        taxRate: 0,
      }
    );
  }

  function handleSupplierChange(nextSupplierId: string) {
    setSupplierId(nextSupplierId);
    setProductSearch("");
    dispatchLines({ type: "supplierChanged" });
    setLineMetaByProductId(new Map());
  }

  function handleCostCurrencyChange(nextCurrency: PurchaseCostCurrency) {
    setCostCurrency(nextCurrency);
    dispatchLines({ currency: nextCurrency, rateVes: activeRateVes, type: "costCurrencyChanged" });
  }

  function handleAddProduct(product: PurchaseCatalogProduct) {
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
      line: buildPurchaseLine(product, {
        costCurrency,
        id: nextPurchaseLineId(),
        rateVes: activeRateVes,
      }),
      rateVes: activeRateVes,
      type: "productAdded",
    });
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
    const input = {
      discountRef,
      discountVes,
      // `taxRateCode` y `taxRate` van juntos: la RPC valida que el porcentaje sea el de la alicuota.
      items: validLines.map(({ item, tax }) => ({
        ...draftToPurchaseItemInput(item, activeRateVes),
        ...(tax.code ? { taxRateCode: tax.code } : {}),
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
    const clientRequestId = requestAttempt.begin(input);

    if (!clientRequestId) {
      return;
    }

    try {
      const purchase = await createPurchase.mutateAsync({ ...input, clientRequestId });

      requestAttempt.succeed();
      router.push(`/purchases/${purchase.id}`);
    } catch (error) {
      // Error surfaced via createPurchase.error
      requestAttempt.fail(error);
    }
  }

  const dependencyError = suppliersQuery.error ?? exchangeRate.error ?? taxRates.error;

  return (
    <div className="space-y-6 pb-8">
      <PurchaseCreateHeader />

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
            suppliers={suppliers}
          />
          <PurchaseProductPickerCard
            catalog={catalog}
            exemptDisabled={!findExemptTaxRate(taxRates.rates)}
            exemptPurchase={taxState.exempt}
            getItemMeta={getItemMeta}
            isSearching={productSearchResult.isSearching}
            lines={lines}
            onAddProduct={handleAddProduct}
            onExemptPurchaseChange={handleExemptPurchaseChange}
            onLineTaxChange={(itemId, code) =>
              dispatchLines({ code, itemId, type: "lineTaxChosen" })
            }
            onRemoveItem={(itemId) => dispatchLines({ itemId, type: "lineRemoved" })}
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
    </div>
  );
}
