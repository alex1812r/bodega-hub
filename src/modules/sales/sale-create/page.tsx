"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { getPaginatedItems } from "@/lib/api/pagination";
import { useMyCashSession } from "@/modules/cash/hooks/useCash";
import { useContacts } from "@/modules/contacts/hooks/useContacts";
import { useCreatePayment } from "@/modules/payments/hooks/usePayments";
import { useProductBarcodeScan } from "@/modules/products/hooks/useProductBarcodeScan";
import { useAllProducts, useCategories } from "@/modules/products/hooks/useProducts";
import { matchesProductSearch } from "@/modules/products/services/productSearch";
import { sortPosCatalogProducts } from "@/modules/sales/sale-create/utils/sortPosCatalogProducts";
import { useCurrentExchangeRate } from "@/modules/settings/hooks/useCurrentExchangeRate";
import { useEnabledPaymentMethods } from "@/modules/settings/hooks/useSettings";
import { ErrorState } from "@/shared/components/ErrorState";
import { PageBackButton } from "@/shared/components/PageBackButton";
import type { PaymentMethod } from "@/shared/mocks/erp-data";
import {
  DEFAULT_ENABLED_PAYMENT_METHODS,
  isPaymentMethodEnabled,
} from "@/shared/payments/paymentMethods";
import { refToVes, roundMoney } from "@/shared/utils/currency";

import { type SaleCreateInput, useCancelSale, useCreateSale } from "../hooks/useSales";
import { PosCartPanel } from "./components/PosCartPanel";
import { PosCashSessionGate } from "./components/PosCashSessionGate";
import { PosCatalogToolbar } from "./components/PosCatalogToolbar";
import { PosCategorySlider } from "./components/PosCategorySlider";
import { PosProductGrid } from "./components/PosProductGrid";
import { PosSaleSuccessOverlay } from "./components/PosSaleSuccessOverlay";
import { PosScanModal } from "./components/PosScanModal";
import { PosSingleMethodDetailsModal } from "./components/PosSingleMethodDetailsModal";
import { PosWorkspace } from "./components/PosWorkspace";
import { posCatalogQueryOptions } from "./constants/posCatalogCache";
import { usePosCart } from "./hooks/usePosCart";
import { toDenominationsPayload } from "./utils/denominations";
import {
  getPaymentCurrency,
  methodRequiresPaymentDetails,
  validateCheckout,
  validateSinglePaymentDetails,
  type PosCheckout,
  type PosSinglePaymentDetails,
} from "./utils/mixedPayments";

type PaymentSelectionSnapshot = {
  details: PosSinglePaymentDetails | null;
  method: PaymentMethod | null;
};

type CompletedSaleSummary = {
  id: string;
  invoiceNumber: string;
};

export function SaleCreatePage() {
  return (
    <PosCashSessionGate>
      <SaleCreatePosWorkspace />
    </PosCashSessionGate>
  );
}

function SaleCreatePosWorkspace() {
  const contacts = useContacts({ limit: 100 }, posCatalogQueryOptions);
  const categories = useCategories({}, posCatalogQueryOptions);
  // Catálogo completo: con `limit: 100` el POS dejaba fuera todo producto que
  // cayera pasado el corte alfabético, y la búsqueda filtra en cliente.
  const products = useAllProducts({ isActive: true }, posCatalogQueryOptions);
  const currentRate = useCurrentExchangeRate();
  const cashSession = useMyCashSession();
  const router = useRouter();
  const createSale = useCreateSale();
  const createPayment = useCreatePayment();
  const cancelSale = useCancelSale();
  const cart = usePosCart();
  // Candado sincrono contra el doble envio: `isPending` tarda un render en
  // reflejarse y en ese hueco un segundo clic ya habia disparado otra venta.
  const submitLockRef = useRef(false);
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
  const [checkout, setCheckout] = useState<PosCheckout | null>(null);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const [formError, setFormError] = useState<string>();
  // Venta que quedo registrada con pagos pero cuyo cobro no termino bien: se
  // ofrece ir al detalle en vez de dejar que el cajero la vuelva a cobrar aqui.
  const [orphanSale, setOrphanSale] = useState<CompletedSaleSummary | null>(null);
  const [completedSale, setCompletedSale] = useState<CompletedSaleSummary | null>(null);

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
    const hasDisabledMethod =
      checkout?.lines.some(
        (line) => !isPaymentMethodEnabled(line.method, enabledPaymentMethods),
      ) ||
      (checkout?.change != null &&
        !isPaymentMethodEnabled(checkout.change.method, enabledPaymentMethods));

    if (hasDisabledMethod) {
      setCheckout(null);
    }
  }, [checkout, enabledPaymentMethods]);

  const customers = useMemo(() => {
    return getPaginatedItems(contacts.data)
      .filter((contact) => contact.type === "cliente" || contact.type === "ambos")
      .slice()
      .sort((left, right) => {
        const leftDefault = left.isPosDefault ? 1 : 0;
        const rightDefault = right.isPosDefault ? 1 : 0;
        if (leftDefault !== rightDefault) {
          return rightDefault - leftDefault;
        }
        return left.name.localeCompare(right.name, "es");
      });
  }, [contacts.data]);
  const defaultCustomerId = useMemo(
    () => customers.find((customer) => customer.isPosDefault)?.id ?? "",
    [customers],
  );
  const categoryOptions = getPaginatedItems(categories.data);
  const activeProducts = getPaginatedItems(products.data);
  const dependencyError = contacts.error ?? products.error ?? currentRate.error;
  const rateVes = currentRate.data?.rateVes ?? 0;
  const drawerVes = cashSession.data?.liveTotals?.cashVes ?? 0;
  const drawerRef = cashSession.data?.liveTotals?.cashRef ?? 0;
  const totalRef = cart.subtotalRef;
  const totalVes = rateVes ? roundMoney(refToVes(totalRef, rateVes)) : 0;
  const isSubmitting =
    createSale.isPending || createPayment.isPending || cancelSale.isPending;

  useEffect(() => {
    if (!customerId && defaultCustomerId) {
      setCustomerId(defaultCustomerId);
    }
  }, [customerId, defaultCustomerId]);

  const cartQuantitiesByProductId = useMemo(() => {
    const quantities = new Map<string, number>();
    for (const item of cart.items) {
      quantities.set(item.productId, item.quantity);
    }
    return quantities;
  }, [cart.items]);

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();

    const filtered = activeProducts.filter((product) => {
      const matchesCategory = !categoryId || product.categoryId === categoryId;
      const matchesSearch = !query || matchesProductSearch(product, query);

      return matchesCategory && matchesSearch;
    });

    return sortPosCatalogProducts(filtered);
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
    setCustomerId(defaultCustomerId);
    setCheckout(null);
    resetPaymentSelection();
  }

  function handleStartNewSale() {
    setCompletedSale(null);
    createSale.reset();
    focusSearchInput();
  }

  function handlePaymentMethodChange(nextMethod: PaymentMethod) {
    if (!isPaymentMethodEnabled(nextMethod, enabledPaymentMethods)) {
      return;
    }

    setCheckout(null);

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
    setOrphanSale(null);

    if (!customerId) {
      setFormError("Selecciona un cliente antes de procesar la venta.");
      return;
    }

    if (cart.items.length === 0) {
      setFormError("Agrega al menos un producto al carrito.");
      return;
    }

    if (checkout) {
      const validation = validateCheckout(totalRef, checkout, rateVes, enabledPaymentMethods, {
        ref: drawerRef,
        ves: drawerVes,
      });
      if (!validation.isValid) {
        setFormError(validation.errors[0] ?? "Revisa el cobro.");
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

    // Doble clic o Enter repetido mientras la primera peticion viaja: sin este
    // candado se creaban dos ventas (y dos descuentos de stock) del mismo carrito.
    if (submitLockRef.current) {
      return;
    }
    submitLockRef.current = true;

    let sale: Awaited<ReturnType<typeof createSale.mutateAsync>> | null = null;

    try {
      sale = await createSale.mutateAsync(input);
    } catch (error) {
      submitLockRef.current = false;
      setFormError(error instanceof Error ? error.message : "No pudimos procesar la venta.");
      return;
    }

    try {
      if (checkout) {
        for (const line of checkout.lines) {
          // El vuelto viaja en la linea que genero el excedente: es la fila
          // `payments` que lleva las columnas `change_*`.
          const carriesChange =
            checkout.change != null && checkout.changeCarrierLineId === line.id;
          const changeMethod = checkout.change?.method;

          await createPayment.mutateAsync({
            amount: line.amount,
            bankName: line.bankName?.trim() || undefined,
            change:
              carriesChange && checkout.change
                ? {
                    amount: checkout.change.amount,
                    method: checkout.change.method,
                  }
                : undefined,
            changeDenominations:
              carriesChange && changeMethod
                ? toDenominationsPayload(
                    getPaymentCurrency(changeMethod),
                    checkout.change?.denominations,
                  )
                : undefined,
            currency: getPaymentCurrency(line.method),
            method: line.method,
            phone: line.phone?.trim() || undefined,
            receivedDenominations: toDenominationsPayload(
              getPaymentCurrency(line.method),
              line.denominations,
            ),
            referenceCode: line.referenceCode?.trim() || undefined,
            saleId: sale.id,
          });
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
    } catch (paymentError) {
      await rollbackSaleAfterPaymentFailure(sale, paymentError);
      submitLockRef.current = false;
      return;
    }

    resetAfterSuccessfulSale();
    setCompletedSale({
      id: sale.id,
      invoiceNumber: sale.invoiceNumber,
    });
    createSale.reset();
    submitLockRef.current = false;
  }

  /**
   * La venta ya existe y descargo inventario cuando el cobro falla. Antes se
   * dejaba viva en `pendiente_pago` con el carrito intacto y el boton habilitado,
   * asi que el cajero reintentaba y creaba otra venta (y otro descuento). Ahora se
   * anula de inmediato para devolver el stock; si no se puede anular es porque
   * algun pago si llego al servidor, y entonces se manda al detalle en vez de
   * permitir un segundo intento a ciegas.
   */
  async function rollbackSaleAfterPaymentFailure(
    sale: { id: string; invoiceNumber: string },
    paymentError: unknown,
  ) {
    const reason =
      paymentError instanceof Error ? paymentError.message : "no se completo el cobro";

    try {
      await cancelSale.mutateAsync(sale.id);
      setFormError(
        `No se pudo cobrar (${reason}). La venta ${sale.invoiceNumber} se anulo y el stock volvio al inventario; el carrito sigue cargado para volver a intentar.`,
      );
    } catch {
      resetAfterSuccessfulSale();
      setOrphanSale(sale);
      setFormError(
        `No se pudo cobrar (${reason}), pero la venta ${sale.invoiceNumber} ya tiene al menos un pago registrado y no se puede anular desde aqui. Revisa o completa el cobro desde el detalle de la venta antes de vender de nuevo.`,
      );
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
          <ErrorState
            actionLabel="Ver venta"
            description={formError}
            onRetry={orphanSale ? () => router.push(`/sales/${orphanSale.id}`) : undefined}
            title="Revisa la venta"
          />
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

      {completedSale ? (
        <PosSaleSuccessOverlay
          invoiceNumber={completedSale.invoiceNumber}
          onNewSale={handleStartNewSale}
        />
      ) : (
        <PosWorkspace
          className="min-h-0 flex-1"
          cart={({ onRequestClose }) => (
            <PosCartPanel
              checkout={checkout}
              className="h-full border-t lg:border-t-0"
              customerId={customerId}
              customers={customers}
              drawerRef={drawerRef}
              drawerVes={drawerVes}
              enabledPaymentMethods={enabledPaymentMethods}
              error={formError}
              isSubmitting={isSubmitting}
              items={cart.items}
              itemsCount={cart.itemsCount}
              onCheckoutChange={(nextCheckout) => {
                setCheckout(nextCheckout);
                setPaymentDetails(null);
                setPaymentDetailsModalOpen(false);
              }}
              onClearCheckout={() => setCheckout(null)}
              onClearOrder={() => {
                cart.clearCart();
                setCheckout(null);
                resetPaymentSelection();
              }}
              onCustomerChange={setCustomerId}
              onEditPaymentDetails={handleOpenPaymentDetailsModal}
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
              selectedQuantities={cartQuantitiesByProductId}
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
      )}

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
