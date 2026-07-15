"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";

import { getPaginatedItems } from "@/lib/api/pagination";
import { useContacts } from "@/modules/contacts/hooks/useContacts";
import { useCreatePayment } from "@/modules/payments/hooks/usePayments";
import { useProductBarcodeScan } from "@/modules/products/hooks/useProductBarcodeScan";
import { useCategories, useProducts } from "@/modules/products/hooks/useProducts";
import { matchesProductSearch } from "@/modules/products/services/productSearch";
import { useCurrentExchangeRate } from "@/modules/settings/hooks/useCurrentExchangeRate";
import { PageBackButton } from "@/shared/components/PageBackButton";
import { Button } from "@/shared/components/Button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/shared/components/Card";
import { ErrorState } from "@/shared/components/ErrorState";
import type { PaymentMethod } from "@/shared/mocks/erp-data";
import { refToVes } from "@/shared/utils/currency";

import { type SaleCreateInput, useCreateSale } from "../hooks/useSales";
import { PosCartPanel } from "./components/PosCartPanel";
import { PosCatalogToolbar } from "./components/PosCatalogToolbar";
import { PosCategorySlider } from "./components/PosCategorySlider";
import { PosProductGrid } from "./components/PosProductGrid";
import { PosScanModal } from "./components/PosScanModal";
import { PosWorkspace } from "./components/PosWorkspace";
import { usePosCart } from "./hooks/usePosCart";

export function SaleCreatePage() {
  const contacts = useContacts({ limit: 100 });
  const categories = useCategories();
  const products = useProducts({ isActive: true, limit: 100 });
  const currentRate = useCurrentExchangeRate();
  const createSale = useCreateSale();
  const createPayment = useCreatePayment();
  const cart = usePosCart();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const barcodeScan = useProductBarcodeScan({ isActive: true });

  const [customerId, setCustomerId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("efectivo_ves");
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const [formError, setFormError] = useState<string>();

  const customers = getPaginatedItems(contacts.data).filter(
    (contact) => contact.type === "cliente" || contact.type === "ambos",
  );
  const categoryOptions = getPaginatedItems(categories.data);
  const activeProducts = getPaginatedItems(products.data);
  const dependencyError = contacts.error ?? products.error ?? currentRate.error;
  const rateVes = currentRate.data?.rateVes ?? 0;
  const totalRef = cart.subtotalRef;
  const totalVes = rateVes ? refToVes(totalRef, rateVes) : 0;
  const isSubmitting = createSale.isPending || createPayment.isPending;

  const cartProductIds = useMemo(
    () => new Set(cart.items.map((item) => item.productId)),
    [cart.items],
  );

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();

    return activeProducts.filter((product) => {
      const matchesCategory = !categoryId || product.categoryId === categoryId;
      const matchesSearch = !query || matchesProductSearch(product, query);

      return matchesCategory && matchesSearch;
    });
  }, [activeProducts, categoryId, search]);

  function handleSearchChange(value: string) {
    barcodeScan.clearScanError();
    setSearch(value);
  }

  function handleBarcodeScanSubmit(code: string) {
    void barcodeScan.handleScanSubmit(code, {
      onResolved: (product) => {
        cart.addProduct(product);
        setSearch("");
        barcodeScan.clearScanError();
      },
    });
  }

  async function handleProcessSale() {
    setFormError(undefined);

    if (!customerId) {
      setFormError("Selecciona un cliente antes de procesar la venta.");
      return;
    }

    if (cart.items.length === 0) {
      setFormError("Agrega al menos un producto al carrito.");
      return;
    }

    const input: SaleCreateInput = {
      customerId,
      items: cart.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
      })),
      refRateVes: rateVes || undefined,
    };

    try {
      const sale = await createSale.mutateAsync(input);

      const paysInUsd = paymentMethod === "efectivo_usd";

      if ((paysInUsd && totalRef > 0) || (!paysInUsd && totalVes > 0)) {
        await createPayment.mutateAsync({
          amount: paysInUsd ? totalRef : totalVes,
          currency: paysInUsd ? "USD" : "VES",
          method: paymentMethod,
          saleId: sale.id,
        });
      }

      cart.clearCart();
      setCustomerId("");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "No pudimos procesar la venta.");
    }
  }

  return (
    <div className="flex min-h-0 w-full max-w-none flex-1 flex-col overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-container-lowest px-4 py-3 dark:border-slate-800">
        <div>
          <p className="text-xs font-semibold tracking-wide text-primary uppercase">
            Punto de venta
          </p>
          <h1 className="text-xl font-semibold text-foreground">Realizar venta</h1>
        </div>
        <PageBackButton href="/sales" label="Volver a ventas" size="sm" />
      </header>

      {formError ? (
        <div className="shrink-0 px-4 pt-4">
          <ErrorState description={formError} title="Revisa la venta" />
        </div>
      ) : null}

      {dependencyError ? (
        <div className="shrink-0 px-4 pt-4">
          <ErrorState
            description={
              dependencyError instanceof Error
                ? dependencyError.message
                : "No pudimos cargar clientes, productos o tasa vigente."
            }
            onRetry={() => {
              void contacts.refetch();
              void products.refetch();
              void currentRate.refetch();
            }}
            title="No pudimos cargar datos base"
          />
        </div>
      ) : null}

      {createSale.data ? (
        <div className="shrink-0 px-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle>Venta registrada</CardTitle>
              <CardDescription>
                Factura {createSale.data.invoiceNumber}. Puedes seguir vendiendo o volver al
                listado.
              </CardDescription>
            </CardHeader>
            <CardFooter className="gap-2">
              <Button asChild size="sm" variant="outline">
                <Link href="/sales">Ver ventas</Link>
              </Button>
              <Button
                onClick={() => createSale.reset()}
                size="sm"
                type="button"
                variant="primary"
              >
                Nueva venta
              </Button>
            </CardFooter>
          </Card>
        </div>
      ) : null}

      {!createSale.data ? (
        <PosWorkspace
          className="min-h-0 flex-1"
          cart={
            <PosCartPanel
              className="h-full border-t lg:border-t-0"
              customerId={customerId}
              customers={customers}
              isSubmitting={isSubmitting}
              items={cart.items}
              itemsCount={cart.itemsCount}
              onClearOrder={cart.clearCart}
              onCustomerChange={setCustomerId}
              onPaymentMethodChange={setPaymentMethod}
              onProcessSale={() => void handleProcessSale()}
              onQuantityChange={cart.setQuantity}
              onRemoveItem={(productId) => cart.setQuantity(productId, 0)}
              paymentMethod={paymentMethod}
              rateVes={rateVes}
              subtotalRef={cart.subtotalRef}
              totalRef={totalRef}
              totalVes={totalVes}
            />
          }
          catalogScroll={
            <PosProductGrid
              isLoading={products.isLoading}
              onAddProduct={cart.addProduct}
              products={filteredProducts}
              rateVes={rateVes}
              selectedProductIds={cartProductIds}
            />
          }
          categorySlider={
            <PosCategorySlider
              categories={categoryOptions}
              onSelect={setCategoryId}
              selectedCategoryId={categoryId}
            />
          }
          toolbar={
            <PosCatalogToolbar
              isLookingUp={barcodeScan.isLookingUp}
              onOpenScan={() => setScanOpen(true)}
              onScanSubmit={handleBarcodeScanSubmit}
              onSearchChange={handleSearchChange}
              ref={searchInputRef}
              scanError={barcodeScan.scanError}
              search={search}
            />
          }
        />
      ) : null}

      <PosScanModal
        onFocusSearch={() => {
          setScanOpen(false);
          searchInputRef.current?.focus();
        }}
        onOpenChange={setScanOpen}
        open={scanOpen}
      />
    </div>
  );
}
