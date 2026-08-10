"use client";

import { Package } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useProductBarcodeScan } from "@/modules/products/hooks/useProductBarcodeScan";
import { PosCatalogToolbar } from "@/modules/sales/sale-create/components/PosCatalogToolbar";
import { PosScanModal } from "@/modules/sales/sale-create/components/PosScanModal";

import type { PurchaseDraftItem } from "../types";
import { resolveSupplierCatalogProduct } from "../services/resolveSupplierCatalogProduct";
import { PurchaseLineItemsTable, type PurchaseLineItemMeta } from "./PurchaseLineItemsTable";

import type { SupplierProductPackUnit } from "@/modules/contacts/types/supplierProducts";

export type PurchaseCatalogProduct = {
  barcode?: string | null;
  defaultPackUnit?: SupplierProductPackUnit;
  name: string;
  packUnits: SupplierProductPackUnit[];
  productId: string;
  sku: string;
  taxRate: number;
  unitCostRef: number;
};

type PurchaseProductPickerCardProps = {
  catalog: PurchaseCatalogProduct[];
  getItemMeta: (productId: string) => PurchaseLineItemMeta;
  isSearching?: boolean;
  items: PurchaseDraftItem[];
  onAddProduct: (product: PurchaseCatalogProduct) => void;
  onRemoveItem: (itemId: string) => void;
  onSearchChange: (value: string) => void;
  onUpdateItem: (itemId: string, input: Partial<PurchaseDraftItem>) => void;
  rateVes: number;
  search: string;
  supplierId: string;
};

export function PurchaseProductPickerCard({
  catalog,
  getItemMeta,
  isSearching = false,
  items,
  onAddProduct,
  onRemoveItem,
  onSearchChange,
  onUpdateItem,
  rateVes,
  search,
  supplierId,
}: PurchaseProductPickerCardProps) {
  const [scanOpen, setScanOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const barcodeScan = useProductBarcodeScan({ isActive: true });
  const hasSupplier = Boolean(supplierId);
  const trimmedSearch = search.trim();
  const showResults = pickerOpen && trimmedSearch.length > 0;

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
    onSearchChange(value);
    setPickerOpen(true);
  }

  async function resolveCatalogProduct(
    productId: string,
  ): Promise<PurchaseCatalogProduct | null> {
    const fromCatalog = catalog.find((item) => item.productId === productId);
    if (fromCatalog) {
      return fromCatalog;
    }

    if (!supplierId) {
      return null;
    }

    return resolveSupplierCatalogProduct(supplierId, productId);
  }

  function handleBarcodeScanSubmit(
    code: string,
    options?: { closeScanOnSuccess?: boolean },
  ) {
    if (!hasSupplier) {
      barcodeScan.setScanError("Selecciona un proveedor antes de escanear productos.");
      return;
    }

    void barcodeScan
      .handleScanSubmit(code, {
        onNotFound: () => undefined,
        onResolved: (product) => {
          void resolveCatalogProduct(product.id).then((catalogProduct) => {
            if (!catalogProduct) {
              barcodeScan.setScanError("Producto no vinculado a este proveedor.");
              return;
            }

            onAddProduct(catalogProduct);
            onSearchChange("");
            setPickerOpen(false);
            barcodeScan.clearScanError();
            if (options?.closeScanOnSuccess) {
              setScanOpen(false);
            }
          });
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
          {showResults && isSearching ? (
            <p className="absolute left-0 right-0 top-full z-20 mt-1 rounded-lg border border-border bg-surface-container-lowest px-4 py-2.5 text-sm text-muted-foreground shadow-lg dark:border-slate-700">
              Buscando...
            </p>
          ) : null}
          {showResults && !isSearching && catalog.length > 0 ? (
            <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-surface-container-lowest py-1 shadow-lg dark:border-slate-700">
              {catalog.map((product) => (
                <li key={product.productId}>
                  <button
                    className="flex w-full cursor-pointer flex-col px-4 py-2.5 text-left transition-colors hover:bg-surface-container-low"
                    onClick={() => {
                      onAddProduct(product);
                      onSearchChange("");
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
          {showResults && !isSearching && catalog.length === 0 ? (
            <p className="absolute left-0 right-0 top-full z-20 mt-1 rounded-lg border border-border bg-surface-container-lowest px-4 py-2.5 text-sm text-muted-foreground shadow-lg dark:border-slate-700">
              Sin resultados
            </p>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <PurchaseLineItemsTable
          getItemMeta={getItemMeta}
          items={items}
          onRemoveItem={onRemoveItem}
          onUpdateItem={onUpdateItem}
          rateVes={rateVes}
        />
      </div>

      <PosScanModal
        isLookingUp={barcodeScan.isLookingUp}
        onDetected={(code) => {
          handleBarcodeScanSubmit(code, { closeScanOnSuccess: true });
        }}
        onFocusSearch={() => {
          setScanOpen(false);
          searchInputRef.current?.focus();
        }}
        onOpenChange={(nextOpen) => {
          setScanOpen(nextOpen);
          if (!nextOpen) {
            barcodeScan.clearScanError();
          }
        }}
        open={scanOpen}
        scanError={barcodeScan.scanError}
      />
    </section>
  );
}
