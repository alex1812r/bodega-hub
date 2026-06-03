"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { getPaginatedItems } from "@/lib/api/pagination";
import { Button } from "@/shared/components/Button";
import { ErrorState } from "@/shared/components/ErrorState";
import { Input } from "@/shared/components/Input";
import { PageHeader } from "@/shared/components/PageHeader";
import { useContacts } from "@/modules/contacts/hooks/useContacts";
import { useProducts } from "@/modules/products/hooks/useProducts";
import { useCurrentExchangeRate } from "@/modules/settings/hooks/useCurrentExchangeRate";

import {
  type PurchaseDraftItem,
  PurchaseItemsTable,
} from "./components/PurchaseItemsTable";
import {
  type PurchaseInitialPayment,
  PurchasePaymentSection,
} from "./components/PurchasePaymentSection";
import { PurchaseSupplierCard } from "./components/PurchaseSupplierCard";
import { PurchaseTotalsCard } from "./components/PurchaseTotalsCard";
import { useCreatePayment } from "@/modules/payments/hooks/usePayments";
import type { PaymentMethod, PurchaseStatus } from "@/shared/mocks/erp-data";
import { SelectField } from "@/shared/components/SelectField";
import { formatRef } from "@/shared/utils/currency";

import { useCreatePurchase, useSupplierProducts } from "../hooks/usePurchases";

const emptyInitialPayment: PurchaseInitialPayment = {
  amount: 0,
  method: "",
  referenceCode: "",
};

function createEmptyItem(productId = "", id = "purchase-item-1"): PurchaseDraftItem {
  return {
    id,
    productId,
    quantity: 1,
    unitCostRef: 0,
  };
}

export function PurchaseCreatePage() {
  const router = useRouter();
  const suppliersQuery = useContacts();
  const productsQuery = useProducts({ isActive: true });
  const exchangeRate = useCurrentExchangeRate();
  const createPurchase = useCreatePurchase();
  const createPayment = useCreatePayment();
  const [supplierId, setSupplierId] = useState("");
  const [status, setStatus] = useState<PurchaseStatus>("recibido");
  const [rateVes, setRateVes] = useState(exchangeRate.data?.rateVes ?? 510);
  const [discountRef, setDiscountRef] = useState(0);
  const [taxRef, setTaxRef] = useState(0);
  const [items, setItems] = useState<PurchaseDraftItem[]>([createEmptyItem()]);
  const [payment, setPayment] = useState<PurchaseInitialPayment>(emptyInitialPayment);
  const [formError, setFormError] = useState<string | null>(null);
  const supplierProducts = useSupplierProducts(supplierId);
  const activeRateVes = exchangeRate.data?.rateVes ?? rateVes;

  const suppliers = useMemo(
    () =>
      getPaginatedItems(suppliersQuery.data).filter(
        (contact) => contact.type === "proveedor" || contact.type === "ambos",
      ),
    [suppliersQuery.data],
  );

  const productOptions = useMemo(() => {
    const supplierRows = getPaginatedItems(supplierProducts.data);

    if (supplierRows.length > 0) {
      return supplierRows
        .filter((row) => row.product)
        .map((row) => ({
          label: `${row.product?.name ?? row.productId} (${row.supplierSku ?? "sin SKU"})`,
          lastCostRef: row.lastCostRef,
          value: row.productId,
        }));
    }

    return getPaginatedItems(productsQuery.data).map((product) => ({
      label: product.name,
      lastCostRef: product.currentCostRef,
      value: product.id,
    }));
  }, [productsQuery.data, supplierProducts.data]);

  const subtotalRef = items.reduce(
    (total, item) => total + item.quantity * item.unitCostRef,
    0,
  );
  const validItems = items.filter(
    (item) => item.productId && item.quantity > 0 && item.unitCostRef >= 0,
  );

  function handleSupplierChange(nextSupplierId: string) {
    setSupplierId(nextSupplierId);
    setItems([createEmptyItem()]);
  }

  function handleAddItem() {
    const firstProduct = productOptions[0];

    setItems((current) => [
      ...current,
      {
        ...createEmptyItem(
          firstProduct?.value ?? "",
          `purchase-item-${current.length + 1}-${Date.now()}`,
        ),
        unitCostRef: firstProduct?.lastCostRef ?? 0,
      },
    ]);
  }

  function handleUpdateItem(itemId: string, input: Partial<PurchaseDraftItem>) {
    setItems((current) =>
      current.map((item) => (item.id === itemId ? { ...item, ...input } : item)),
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

    if (payment.amount > 0 && !payment.method) {
      setFormError("Selecciona un metodo de pago para el pago inicial.");
      return;
    }

    setFormError(null);
    const purchase = await createPurchase.mutateAsync({
      discountRef,
      items: validItems.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        unitCostRef: item.unitCostRef,
      })),
      refRateVes: activeRateVes,
      status,
      supplierId,
      taxRef,
    });

    if (payment.amount > 0 && payment.method) {
      await createPayment.mutateAsync({
        amount: payment.amount,
        method: payment.method as PaymentMethod,
        purchaseId: purchase.id,
        referenceCode: payment.referenceCode || undefined,
      });
    }

    router.push(`/purchases/${purchase.id}`);
  }

  const totalRef = subtotalRef - discountRef + taxRef;

  return (
    <div className="space-y-5 pb-24 lg:pb-6">
      <PageHeader
        actions={
          <>
            <Button asChild className="w-full sm:w-auto" variant="outline">
              <Link href="/purchases">Volver</Link>
            </Button>
            <Button
              className="hidden w-full sm:w-auto lg:inline-flex"
              disabled={createPurchase.isPending}
              onClick={() => void handleSubmit()}
            >
              {createPurchase.isPending ? "Confirmando..." : "Confirmar compra"}
            </Button>
          </>
        }
        badge={<p className="text-sm font-medium text-blue-600">Compras</p>}
        description="Pantalla visual para registrar productos comprados a un proveedor."
        title="Registrar compra"
      />

      {formError || createPurchase.error ? (
        <ErrorState
          description={formError ?? createPurchase.error?.message}
          title="No pudimos registrar la compra"
        />
      ) : null}

      <PurchaseSupplierCard
        isRateLoading={exchangeRate.isLoading}
        onRateChange={setRateVes}
        onSupplierChange={handleSupplierChange}
        rateVes={activeRateVes}
        selectedSupplierId={supplierId}
        suppliers={suppliers}
      />
      <PurchaseItemsTable
        items={items}
        onAddItem={handleAddItem}
        onRemoveItem={handleRemoveItem}
        onUpdateItem={handleUpdateItem}
        productOptions={productOptions}
        rateVes={activeRateVes}
      />
      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <div className="min-w-0 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectField
              label="Estado inicial"
              onChange={(event) => setStatus(event.target.value as PurchaseStatus)}
              options={[
                { label: "Pedido", value: "pedido" },
                { label: "Recibido", value: "recibido" },
              ]}
              value={status}
            />
            <Input
              label="Descuento ref"
              min="0"
              onChange={(event) => setDiscountRef(Number(event.target.value))}
              type="number"
              value={discountRef}
            />
            <Input
              label="Impuesto ref"
              min="0"
              onChange={(event) => setTaxRef(Number(event.target.value))}
              type="number"
              value={taxRef}
            />
          </div>
          <PurchaseTotalsCard
            discountRef={discountRef}
            rateVes={activeRateVes}
            subtotalRef={subtotalRef}
            taxRef={taxRef}
          />
        </div>
        <PurchasePaymentSection onPaymentChange={setPayment} payment={payment} />
      </div>
      {createPayment.error ? (
        <ErrorState
          description={createPayment.error.message}
          title="La compra se creo pero fallo el pago inicial"
        />
      ) : null}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 lg:hidden">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-slate-500 dark:text-slate-400">Subtotal ref</p>
            <p className="truncate text-lg font-semibold">{formatRef(totalRef)}</p>
          </div>
          <Button
            className="shrink-0"
            disabled={createPurchase.isPending}
            onClick={() => void handleSubmit()}
          >
            {createPurchase.isPending ? "Confirmando..." : "Confirmar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
