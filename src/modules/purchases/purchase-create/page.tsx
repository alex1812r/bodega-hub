"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { getPaginatedItems } from "@/lib/api/pagination";
import { useContacts } from "@/modules/contacts/hooks/useContacts";
import { useCurrentExchangeRate } from "@/modules/settings/hooks/useCurrentExchangeRate";
import { ErrorState } from "@/shared/components/ErrorState";
import type { PurchaseStatus } from "@/shared/mocks/erp-data";

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
  getDraftSubtotalRef,
  syncPackDerivedFields,
} from "./utils/normalizePurchaseLine";

export function PurchaseCreatePage() {
  const router = useRouter();
  const suppliersQuery = useContacts({ limit: 100, type: "proveedor" });
  const exchangeRate = useCurrentExchangeRate();
  const createPurchase = useCreatePurchase();
  const [supplierId, setSupplierId] = useState("");
  const [status, setStatus] = useState<PurchaseStatus>("recibido");
  const [notes, setNotes] = useState("");
  const [discountRef, setDiscountRef] = useState(0);
  const [items, setItems] = useState<PurchaseDraftItem[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const supplierProducts = useSupplierProducts(supplierId);
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

  const metaByProductId = useMemo(() => {
    const map = new Map<string, PurchaseLineItemMeta>();
    for (const product of catalog) {
      map.set(product.productId, {
        name: product.name,
        packUnits: product.packUnits,
        sku: product.sku,
      });
    }
    return map;
  }, [catalog]);

  const subtotalRef = items.reduce(
    (total, item) => total + getDraftSubtotalRef(syncPackDerivedFields(item)),
    0,
  );
  const taxRef = 0;
  const validItems = items.filter((item) => {
    const normalized = syncPackDerivedFields(item);
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
    return metaByProductId.get(productId) ?? { name: "Producto", sku: "—" };
  }

  function handleSupplierChange(nextSupplierId: string) {
    setSupplierId(nextSupplierId);
    setItems([]);
  }

  function handleAddProduct(product: PurchaseCatalogProduct) {
    setItems((current) => {
      const existing = current.find((item) => item.productId === product.productId);

      if (existing) {
        if (existing.entryMode === "pack") {
          return current.map((item) =>
            item.id === existing.id
              ? syncPackDerivedFields({
                  ...item,
                  packCount: item.packCount + 1,
                })
              : item,
          );
        }

        return current.map((item) =>
          item.id === existing.id ? { ...item, quantity: item.quantity + 1 } : item,
        );
      }

      const defaultPack = product.defaultPackUnit ?? product.packUnits[0];

      if (defaultPack) {
        const packCostRef =
          product.unitCostRef > 0
            ? Math.round(product.unitCostRef * defaultPack.unitsPerPack * 100) / 100
            : 0;

        return [
          ...current,
          createPackDraftItem({
            id: `purchase-item-${Date.now()}`,
            packCostRef,
            packLabel: defaultPack.label,
            packUnitId: defaultPack.id,
            productId: product.productId,
            unitCostRef: product.unitCostRef,
            unitsPerPack: defaultPack.unitsPerPack,
          }),
        ];
      }

      return [
        ...current,
        createUnitDraftItem({
          id: `purchase-item-${Date.now()}`,
          productId: product.productId,
          unitCostRef: product.unitCostRef,
        }),
      ];
    });
  }

  function handleUpdateItem(itemId: string, input: Partial<PurchaseDraftItem>) {
    setItems((current) =>
      current.map((item) =>
        item.id === itemId ? syncPackDerivedFields({ ...item, ...input }) : item,
      ),
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
      const purchase = await createPurchase.mutateAsync({
        discountRef,
        items: validItems.map((item) => draftToPurchaseItemInput(syncPackDerivedFields(item))),
        notes: notes.trim() || undefined,
        refRateVes: activeRateVes,
        status,
        supplierId,
        taxRef,
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
            hasSupplier={Boolean(supplierId)}
            items={items}
            onAddProduct={handleAddProduct}
            onRemoveItem={handleRemoveItem}
            onUpdateItem={handleUpdateItem}
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
            isSubmitting={createPurchase.isPending}
            onConfirm={() => void handleSubmit()}
            onDiscountChange={setDiscountRef}
            rateVes={activeRateVes}
            subtotalRef={subtotalRef}
            taxPercentLabel="0%"
            taxRef={taxRef}
          />
        </div>
      </div>
    </div>
  );
}
