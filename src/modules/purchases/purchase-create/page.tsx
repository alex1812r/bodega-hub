"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { getPaginatedItems } from "@/lib/api/pagination";
import { useContacts } from "@/modules/contacts/hooks/useContacts";
import { useCurrentExchangeRate } from "@/modules/settings/hooks/useCurrentExchangeRate";
import { ErrorState } from "@/shared/components/ErrorState";
import { useDebouncedValue } from "@/shared/hooks/useDebouncedValue";
import type { PurchaseStatus } from "@/shared/mocks/erp-data";
import { refToVes, roundMoney } from "@/shared/utils/currency";

import { PurchaseCreateHeader } from "./components/PurchaseCreateHeader";
import {
  PurchaseProductPickerCard,
  type PurchaseCatalogProduct,
} from "./components/PurchaseProductPickerCard";
import { buildPurchaseCatalog } from "./utils/buildPurchaseCatalog";
import { PurchaseStatusNotesCard } from "./components/PurchaseStatusNotesCard";
import { PurchaseSummaryCard } from "./components/PurchaseSummaryCard";
import { PurchaseSupplierCard } from "./components/PurchaseSupplierCard";
import type { PurchaseLineItemMeta } from "./components/PurchaseLineItemsTable";
import { useCreatePurchase, useSupplierProducts } from "../hooks/usePurchases";
import {
  createPackDraftItem,
  createUnitDraftItem,
  type PurchaseDraftItem,
} from "./types";
import {
  draftToPurchaseItemInput,
  sumDraftPurchaseTotals,
  switchCostCurrency,
  syncLineCostFields,
} from "./utils/normalizePurchaseLine";

const PRODUCT_SEARCH_DEBOUNCE_MS = 300;
const PRODUCT_SEARCH_LIMIT = 20;

export function PurchaseCreatePage() {
  const router = useRouter();
  const suppliersQuery = useContacts({ limit: 100, type: "proveedor" });
  const exchangeRate = useCurrentExchangeRate();
  const createPurchase = useCreatePurchase();
  const [supplierId, setSupplierId] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [status, setStatus] = useState<PurchaseStatus>("recibido");
  const [notes, setNotes] = useState("");
  const [discountRef, setDiscountRef] = useState(0);
  const [items, setItems] = useState<PurchaseDraftItem[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [lineMetaByProductId, setLineMetaByProductId] = useState(
    () => new Map<string, PurchaseLineItemMeta>(),
  );
  const debouncedProductSearch = useDebouncedValue(
    productSearch.trim(),
    PRODUCT_SEARCH_DEBOUNCE_MS,
  );
  const supplierProducts = useSupplierProducts(
    debouncedProductSearch ? supplierId : undefined,
    {
      limit: PRODUCT_SEARCH_LIMIT,
      search: debouncedProductSearch || undefined,
    },
  );
  const activeRateVes = exchangeRate.data?.rateVes ?? 510;

  const suppliers = useMemo(
    () =>
      getPaginatedItems(suppliersQuery.data).filter(
        (contact) => contact.type === "proveedor" || contact.type === "ambos",
      ),
    [suppliersQuery.data],
  );

  const catalog = useMemo(
    () => buildPurchaseCatalog(supplierId, getPaginatedItems(supplierProducts.data)),
    [supplierId, supplierProducts.data],
  );

  useEffect(() => {
    if (!supplierId) {
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

  // Un solo calculo de totales: la suma de las lineas ya redondeadas, en ambas
  // monedas, para que el resumen no pueda desalinearse de lo que muestra la tabla.
  const syncedItems = useMemo(
    () => items.map((item) => syncLineCostFields(item, activeRateVes)),
    [activeRateVes, items],
  );
  const totals = useMemo(
    () => sumDraftPurchaseTotals(syncedItems, activeRateVes),
    [activeRateVes, syncedItems],
  );
  const discountVes = roundMoney(refToVes(discountRef, activeRateVes));
  const validItems = items.filter((item) => {
    const normalized = syncLineCostFields(item, activeRateVes);
    if (!item.productId) return false;
    if (item.entryMode === "pack") {
      return (
        item.packCount > 0 &&
        item.unitsPerPack > 0 &&
        item.packCostRef >= 0 &&
        item.packLabel.trim().length > 0 &&
        normalized.quantity > 0
      );
    }

    return normalized.quantity > 0 && normalized.unitCostRef >= 0;
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
    setItems([]);
    setLineMetaByProductId(new Map());
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

    setItems((current) => {
      const existing = current.find((item) => item.productId === product.productId);

      if (existing) {
        const rest = current.filter((item) => item.id !== existing.id);
        const bumped =
          existing.entryMode === "pack"
            ? syncLineCostFields(
                {
                  ...existing,
                  packCount: existing.packCount + 1,
                },
                activeRateVes,
              )
            : syncLineCostFields(
                { ...existing, quantity: existing.quantity + 1 },
                activeRateVes,
              );

        return [bumped, ...rest];
      }

      const defaultPack = product.defaultPackUnit ?? product.packUnits[0];

      if (defaultPack) {
        const packCostRef =
          product.unitCostRef > 0
            ? Math.round(product.unitCostRef * defaultPack.unitsPerPack * 100) / 100
            : 0;

        return [
          createPackDraftItem({
            costCurrency: "ves",
            id: `purchase-item-${Date.now()}`,
            packCostRef,
            packLabel: defaultPack.label,
            packUnitId: defaultPack.id,
            productId: product.productId,
            rateVes: activeRateVes,
            taxRate: product.taxRate,
            unitCostRef: product.unitCostRef,
            unitsPerPack: defaultPack.unitsPerPack,
          }),
          ...current,
        ];
      }

      return [
        createUnitDraftItem({
          costCurrency: "ves",
          id: `purchase-item-${Date.now()}`,
          productId: product.productId,
          rateVes: activeRateVes,
          taxRate: product.taxRate,
          unitCostRef: product.unitCostRef,
        }),
        ...current,
      ];
    });
  }

  function handleUpdateItem(itemId: string, input: Partial<PurchaseDraftItem>) {
    setItems((current) =>
      current.map((item) => {
        if (item.id !== itemId) {
          return item;
        }

        if (
          input.costCurrency != null &&
          input.costCurrency !== item.costCurrency &&
          Object.keys(input).length === 1
        ) {
          return switchCostCurrency(item, input.costCurrency, activeRateVes);
        }

        return syncLineCostFields({ ...item, ...input }, activeRateVes);
      }),
    );
  }

  function handleRemoveItem(itemId: string) {
    setItems((current) => current.filter((item) => item.id !== itemId));
  }

  async function handleSubmit() {
    if (!supplierId) {
      setFormError("Selecciona un proveedor antes de confirmar la compra.");
      return;
    }

    if (validItems.length === 0) {
      setFormError("Agrega al menos un producto con cantidad y costo validos.");
      return;
    }

    setFormError(null);

    try {
      const syncedValidItems = validItems.map((item) =>
        syncLineCostFields(item, activeRateVes),
      );
      // Mismos helpers que pintan la tabla y el resumen: lo que se envia es
      // exactamente lo que el usuario vio.
      const submitTotals = sumDraftPurchaseTotals(syncedValidItems, activeRateVes);

      const purchase = await createPurchase.mutateAsync({
        discountRef,
        discountVes,
        items: syncedValidItems.map((item) =>
          draftToPurchaseItemInput(item, activeRateVes),
        ),
        notes: notes.trim() || undefined,
        refRateVes: activeRateVes,
        status,
        subtotalRef: submitTotals.subtotalRef,
        subtotalVes: submitTotals.subtotalVes,
        supplierId,
        taxRef: submitTotals.taxRef,
        taxVes: submitTotals.taxVes,
      });

      router.push(`/purchases/${purchase.id}`);
    } catch {
      // Error surfaced via createPurchase.error
    }
  }

  const dependencyError =
    suppliersQuery.error ?? exchangeRate.error ?? supplierProducts.error;

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
            getItemMeta={getItemMeta}
            isSearching={
              Boolean(productSearch.trim()) &&
              (supplierProducts.isFetching ||
                productSearch.trim() !== debouncedProductSearch)
            }
            items={items}
            onAddProduct={handleAddProduct}
            onRemoveItem={handleRemoveItem}
            onSearchChange={setProductSearch}
            onUpdateItem={handleUpdateItem}
            rateVes={activeRateVes}
            search={productSearch}
            supplierId={supplierId}
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
            discountRef={discountRef}
            discountVes={discountVes}
            isSubmitting={createPurchase.isPending}
            onConfirm={() => void handleSubmit()}
            onDiscountChange={setDiscountRef}
            subtotalRef={totals.subtotalRef}
            subtotalVes={totals.subtotalVes}
            taxPercentLabel={(() => {
              if (items.length === 0) return "—";
              const rates = new Set(items.map((item) => item.taxRate));
              if (rates.size === 1) return `${items[0]?.taxRate ?? 0}%`;
              return "mixto";
            })()}
            taxRef={totals.taxRef}
            taxVes={totals.taxVes}
          />
        </div>
      </div>
    </div>
  );
}
