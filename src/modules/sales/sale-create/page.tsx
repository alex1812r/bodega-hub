"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { getPaginatedItems } from "@/lib/api/pagination";
import { useContacts } from "@/modules/contacts/hooks/useContacts";
import { useCreatePayment } from "@/modules/payments/hooks/usePayments";
import { useProductBarcodeScan } from "@/modules/products/hooks/useProductBarcodeScan";
import { useCategories, useProducts } from "@/modules/products/hooks/useProducts";
import { matchesProductSearch } from "@/modules/products/services/productSearch";
import { useCurrentExchangeRate } from "@/modules/settings/hooks/useCurrentExchangeRate";
import { useEnabledPaymentMethods } from "@/modules/settings/hooks/useSettings";
import { PageBackButton } from "@/shared/components/PageBackButton";
import { Button } from "@/shared/components/Button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/shared/components/Card";
import { ErrorState } from "@/shared/components/ErrorState";
import type { PaymentMethod } from "@/shared/mocks/erp-data";
import {
  DEFAULT_ENABLED_PAYMENT_METHODS,
  isPaymentMethodEnabled,
} from "@/shared/payments/paymentMethods";
import { refToVes } from "@/shared/utils/currency";

import { type SaleCreateInput, useCreateSale } from "../hooks/useSales";
import { PosCartPanel } from "./components/PosCartPanel";
import { PosCatalogToolbar } from "./components/PosCatalogToolbar";
import { PosCategorySlider } from "./components/PosCategorySlider";
import { PosProductGrid } from "./components/PosProductGrid";
import { PosScanModal } from "./components/PosScanModal";
import { PosSingleMethodDetailsModal } from "./components/PosSingleMethodDetailsModal";
import { PosWorkspace } from "./components/PosWorkspace";
import { usePosCart } from "./hooks/usePosCart";
import {
  getPaymentCurrency,
  methodRequiresPaymentDetails,
  validateMixedPayments,
  validateSinglePaymentDetails,
  type PosMixedPaymentLine,
  type PosSinglePaymentDetails,
} from "./utils/mixedPayments";

type PaymentSelectionSnapshot = {
  details: PosSinglePaymentDetails | null;
  method: PaymentMethod | null;
};

export function SaleCreatePage() {
  const contacts = useContacts({ limit: 100 });
  const categories = useCategories();
  const products = useProducts({ isActive: true, limit: 100 });
  const currentRate = useCurrentExchangeRate();
  const createSale = useCreateSale();
  const createPayment = useCreatePayment();
  const cart = usePosCart();
  const enabledPaymentMethodsQuery = useEnabledPaymentMethods();
  const enabledPaymentMethods =
    enabledPaymentMethodsQuery.data ?? DEFAULT_ENABLED_PAYMENT_METHODS;
  const searchInputRef = useRef<HTMLInputElement>(null);
  const barcodeScan = useProductBarcodeScan({ isActive: true });
  const paymentSelectionSnapshotRef = useRef<PaymentSelectionSnapshot>({
    details: null,
    method: null,
  });

  const [customerId, setCustomerId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [paymentDetails, setPaymentDetails] = useState<PosSinglePaymentDetails | null>(null);
  const [paymentDetailsModalOpen, setPaymentDetailsModalOpen] = useState(false);
  const [mixedPayments, setMixedPayments] = useState<PosMixedPaymentLine[] | null>(null);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const [formError, setFormError] = useState<string>();

  useEffect(() => {
    // Recover interaction if a previous modal guard left the page blocked.
    if (document.body.style.pointerEvents === "none") {
      document.body.style.pointerEvents = "";
    }
  }, []);

  useEffect(() => {
    if (
      paymentMethod &&
      !isPaymentMethodEnabled(paymentMethod, enabledPaymentMethods)
    ) {
      setPaymentMethod(null);
      setPaymentDetails(null);
      setPaymentDetailsModalOpen(false);
    }
  }, [enabledPaymentMethods, paymentMethod]);

  useEffect(() => {
    if (
      mixedPayments?.some(
        (line) => !isPaymentMethodEnabled(line.method, enabledPaymentMethods),
      )
    ) {
      setMixedPayments(null);
    }
  }, [enabledPaymentMethods, mixedPayments]);

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

  function focusSearchInput() {
    // Defer until after React re-enables the input / clears the value.
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
  }

  function handleSearchChange(value: string) {
    barcodeScan.clearScanError();
    setSearch(value);
  }

  function handleBarcodeScanSubmit(code: string) {
    void barcodeScan
      .handleScanSubmit(code, {
        onResolved: (product) => {
          cart.addProduct(product);
          setSearch("");
          barcodeScan.clearScanError();
        },
      })
      .finally(() => {
        focusSearchInput();
      });
  }

  function resetPaymentSelection() {
    setPaymentMethod(null);
    setPaymentDetails(null);
    setPaymentDetailsModalOpen(false);
    paymentSelectionSnapshotRef.current = {
      details: null,
      method: null,
    };
  }

  function resetAfterSuccessfulSale() {
    cart.clearCart();
    setCustomerId("");
    setMixedPayments(null);
    resetPaymentSelection();
  }

  function handlePaymentMethodChange(nextMethod: PaymentMethod) {
    if (!isPaymentMethodEnabled(nextMethod, enabledPaymentMethods)) {
      return;
    }

    setMixedPayments(null);

    if (methodRequiresPaymentDetails(nextMethod)) {
      paymentSelectionSnapshotRef.current = {
        details: paymentDetails,
        method: paymentMethod,
      };

      if (nextMethod !== paymentMethod) {
        setPaymentDetails(null);
      }

      setPaymentMethod(nextMethod);
      setPaymentDetailsModalOpen(true);
      return;
    }

    setPaymentMethod(nextMethod);
    setPaymentDetails(null);
    setPaymentDetailsModalOpen(false);
  }

  function handlePaymentDetailsConfirm(details: PosSinglePaymentDetails) {
    setPaymentDetails(details);
  }

  function handlePaymentDetailsCancel() {
    const applied =
      paymentMethod != null &&
      validateSinglePaymentDetails(paymentMethod, paymentDetails).isValid;
    if (applied) {
      return;
    }

    const snapshot = paymentSelectionSnapshotRef.current;
    setPaymentMethod(snapshot.method);
    setPaymentDetails(snapshot.details);
  }

  function handleOpenPaymentDetailsModal() {
    if (!methodRequiresPaymentDetails(paymentMethod)) {
      return;
    }

    paymentSelectionSnapshotRef.current = {
      details: paymentDetails,
      method: paymentMethod,
    };
    setPaymentDetailsModalOpen(true);
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

    if (mixedPayments) {
      const validation = validateMixedPayments(
        totalRef,
        mixedPayments,
        rateVes,
        enabledPaymentMethods,
      );
      if (!validation.isValid) {
        setFormError(validation.errors[0] ?? "Revisa el pago mixto.");
        return;
      }
    } else if (!paymentMethod) {
      setFormError("Selecciona un metodo de pago antes de procesar la venta.");
      return;
    } else if (!isPaymentMethodEnabled(paymentMethod, enabledPaymentMethods)) {
      setFormError("El metodo de pago seleccionado ya no esta habilitado.");
      setPaymentMethod(null);
      setPaymentDetails(null);
      return;
    } else if (methodRequiresPaymentDetails(paymentMethod)) {
      const validation = validateSinglePaymentDetails(paymentMethod, paymentDetails);
      if (!validation.isValid) {
        setFormError(validation.errors[0] ?? "Completa los datos del metodo de pago.");
        setPaymentDetailsModalOpen(true);
        return;
      }
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

      if (mixedPayments) {
        try {
          for (const line of mixedPayments) {
            await createPayment.mutateAsync({
              amount: line.amount,
              bankName: line.bankName?.trim() || undefined,
              currency: getPaymentCurrency(line.method),
              method: line.method,
              phone: line.phone?.trim() || undefined,
              referenceCode: line.referenceCode?.trim() || undefined,
              saleId: sale.id,
            });
          }
        } catch (paymentError) {
          setFormError(
            paymentError instanceof Error
              ? `Venta ${sale.invoiceNumber} creada, pero un pago fallo: ${paymentError.message}`
              : `Venta ${sale.invoiceNumber} creada, pero no se completaron todos los pagos.`,
          );
          return;
        }
      } else if (paymentMethod) {
        const paysInUsd = paymentMethod === "efectivo_usd";

        if ((paysInUsd && totalRef > 0) || (!paysInUsd && totalVes > 0)) {
          await createPayment.mutateAsync({
            amount: paysInUsd ? totalRef : totalVes,
            bankName: paymentDetails?.bankName.trim() || undefined,
            currency: paysInUsd ? "USD" : "VES",
            method: paymentMethod,
            phone: paymentDetails?.phone.trim() || undefined,
            referenceCode: paymentDetails?.referenceCode.trim() || undefined,
            saleId: sale.id,
          });
        }
      }

      resetAfterSuccessfulSale();
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
          cart={({ onRequestClose }) => (
            <PosCartPanel
              className="h-full border-t lg:border-t-0"
              customerId={customerId}
              customers={customers}
              enabledPaymentMethods={enabledPaymentMethods}
              isSubmitting={isSubmitting}
              items={cart.items}
              itemsCount={cart.itemsCount}
              mixedPayments={mixedPayments}
              onClearMixedPayments={() => setMixedPayments(null)}
              onClearOrder={() => {
                cart.clearCart();
                setMixedPayments(null);
                resetPaymentSelection();
              }}
              onCustomerChange={setCustomerId}
              onEditPaymentDetails={handleOpenPaymentDetailsModal}
              onMixedPaymentsChange={(lines) => {
                setMixedPayments(lines);
                setPaymentDetails(null);
                setPaymentDetailsModalOpen(false);
              }}
              onPaymentMethodChange={handlePaymentMethodChange}
              onProcessSale={() => void handleProcessSale()}
              onQuantityChange={cart.setQuantity}
              onRemoveItem={(productId) => cart.setQuantity(productId, 0)}
              onRequestClose={onRequestClose}
              paymentDetails={paymentDetails}
              paymentMethod={paymentMethod}
              rateVes={rateVes}
              subtotalRef={cart.subtotalRef}
              totalRef={totalRef}
              totalVes={totalVes}
            />
          )}
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
          itemsCount={cart.itemsCount}
          rateVes={rateVes}
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
          totalRef={totalRef}
          totalVes={totalVes}
        />
      ) : null}

      <PosScanModal
        isLookingUp={barcodeScan.isLookingUp}
        onDetected={(code) => {
          void barcodeScan
            .handleScanSubmit(code, {
              onResolved: (product) => {
                cart.addProduct(product);
                setSearch("");
                barcodeScan.clearScanError();
                setScanOpen(false);
                focusSearchInput();
              },
            })
            .finally(() => {
              // Keep modal open on errors so the user can retry immediately.
            });
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

      <PosSingleMethodDetailsModal
        initialDetails={paymentDetails}
        method={
          paymentMethod && methodRequiresPaymentDetails(paymentMethod) ? paymentMethod : null
        }
        onCancel={handlePaymentDetailsCancel}
        onConfirm={handlePaymentDetailsConfirm}
        onOpenChange={setPaymentDetailsModalOpen}
        open={paymentDetailsModalOpen}
      />
    </div>
  );
}
