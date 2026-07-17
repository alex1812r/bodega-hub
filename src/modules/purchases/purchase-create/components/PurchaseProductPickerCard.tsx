"use client";

import { Package } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useProductBarcodeScan } from "@/modules/products/hooks/useProductBarcodeScan";
import { PosCatalogToolbar } from "@/modules/sales/sale-create/components/PosCatalogToolbar";
import { PosScanModal } from "@/modules/sales/sale-create/components/PosScanModal";
import { matchesProductSearch } from "@/modules/products/services/productSearch";

import type { PurchaseDraftItem } from "../types";
import { PurchaseLineItemsTable, type PurchaseLineItemMeta } from "./PurchaseLineItemsTable";

import type { SupplierProductPackUnit } from "@/modules/contacts/types/supplierProducts";

export type PurchaseCatalogProduct = {
  barcode?: string | null;
  defaultPackUnit?: SupplierProductPackUnit;
  name: string;
  packUnits: SupplierProductPackUnit[];
  productId: string;
  sku: string;
  unitCostRef: number;
};

type PurchaseProductPickerCardProps = {
  catalog: PurchaseCatalogProduct[];
  getItemMeta: (productId: string) => PurchaseLineItemMeta;
  hasSupplier: boolean;
  items: PurchaseDraftItem[];
  onAddProduct: (product: PurchaseCatalogProduct) => void;
  onRemoveItem: (itemId: string) => void;
  onUpdateItem: (itemId: string, input: Partial<PurchaseDraftItem>) => void;
};

export function PurchaseProductPickerCard({
  catalog,
  getItemMeta,
  hasSupplier,
  items,
  onAddProduct,
  onRemoveItem,
  onUpdateItem,
}: PurchaseProductPickerCardProps) {
  const [search, setSearch] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const barcodeScan = useProductBarcodeScan({ isActive: true });

  const matches = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return [];
    }

    return catalog
      .filter((product) =>
        matchesProductSearch(
          { barcode: product.barcode, name: product.name, sku: product.sku },
          term,
        ),
      )
      .slice(0, 8);
  }, [catalog, search]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setPickerOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  function focusSearchInput() {
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
  }

  function handleSearchChange(value: string) {
    barcodeScan.clearScanError();
    setSearch(value);
    setPickerOpen(true);
  }

  function handleBarcodeScanSubmit(code: string) {
    if (!hasSupplier) {
      barcodeScan.setScanError("Selecciona un proveedor antes de escanear productos.");
      return;
    }

    void barcodeScan
      .handleScanSubmit(code, {
        onNotFound: () => undefined,
        onResolved: (product) => {
          const catalogProduct = catalog.find((item) => item.productId === product.id);
          if (!catalogProduct) {
            barcodeScan.setScanError("Producto no vinculado a este proveedor.");
            return;
          }

          onAddProduct(catalogProduct);
          setSearch("");
          setPickerOpen(false);
          barcodeScan.clearScanError();
        },
      })
      .finally(() => {
        focusSearchInput();
      });
  }

  return (
    <section className="flex min-h-[31.25rem] flex-col overflow-hidden rounded-xl border border-border bg-surface-container-lowest shadow-sm dark:border-slate-800">
      <h3 className="flex items-center gap-2 border-b border-border px-5 py-4 text-sm font-medium text-foreground dark:border-slate-800">
        <Package aria-hidden className="size-[1.125rem] text-primary" />
        Productos de la compra
      </h3>

      <div className="border-b border-border px-4 py-4 dark:border-slate-800">
        <div className="relative" ref={containerRef}>
          <PosCatalogToolbar
            autoFocus={false}
            embedded
            isLookingUp={barcodeScan.isLookingUp}
            onOpenScan={() => setScanOpen(true)}
            onScanSubmit={handleBarcodeScanSubmit}
            onSearchChange={handleSearchChange}
            placeholder="Buscar por nombre o codigo de barras..."
            ref={searchInputRef}
            scanError={barcodeScan.scanError}
            search={search}
          />
          {pickerOpen && search.trim() && matches.length > 0 ? (
            <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-surface-container-lowest py-1 shadow-lg dark:border-slate-700">
              {matches.map((product) => (
                <li key={product.productId}>
                  <button
                    className="flex w-full cursor-pointer flex-col px-4 py-2.5 text-left transition-colors hover:bg-surface-container-low"
                    onClick={() => {
                      onAddProduct(product);
                      setSearch("");
                      setPickerOpen(false);
                    }}
                    type="button"
                  >
                    <span className="text-sm font-medium text-foreground">{product.name}</span>
                    <span className="text-xs text-on-surface-variant">{product.sku}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <PurchaseLineItemsTable
          getItemMeta={getItemMeta}
          items={items}
          onRemoveItem={onRemoveItem}
          onUpdateItem={onUpdateItem}
        />
      </div>

      <PosScanModal
        onFocusSearch={() => {
          setScanOpen(false);
          searchInputRef.current?.focus();
        }}
        onOpenChange={setScanOpen}
        open={scanOpen}
      />
    </section>
  );
}
