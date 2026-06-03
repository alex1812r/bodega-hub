"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";

import { getPaginatedItems } from "@/lib/api/pagination";
import { useContacts } from "@/modules/contacts/hooks/useContacts";
import { useProducts } from "@/modules/products/hooks/useProducts";
import { useCurrentExchangeRate } from "@/modules/settings/hooks/useCurrentExchangeRate";
import { Button } from "@/shared/components/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/shared/components/Card";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { EmptyState } from "@/shared/components/EmptyState";
import { ErrorState } from "@/shared/components/ErrorState";
import { Input } from "@/shared/components/Input";
import { PageHeader } from "@/shared/components/PageHeader";
import { SelectField } from "@/shared/components/SelectField";
import { Textarea } from "@/shared/components/Textarea";
import { formatRef, formatVes, refToVes } from "@/shared/utils/currency";

import { type SaleCreateInput, useCreateSale } from "../hooks/useSales";

type CartItem = {
  productId: string;
  productName: string;
  quantity: number;
  stock: number;
  unitPriceRef: number;
};

const itemColumns: DataTableColumn<CartItem>[] = [
  {
    header: "Producto",
    hideInCard: true,
    key: "product",
    render: (item) => item.productName,
  },
  { align: "right", header: "Cantidad", key: "quantity", render: (item) => item.quantity },
  {
    align: "right",
    header: "Precio ref",
    key: "unitPriceRef",
    render: (item) => formatRef(item.unitPriceRef),
  },
  {
    align: "right",
    header: "Subtotal ref",
    key: "subtotalRef",
    render: (item) => formatRef(item.unitPriceRef * item.quantity),
  },
];

export function SaleCreatePage() {
  const contacts = useContacts();
  const products = useProducts({ isActive: true });
  const currentRate = useCurrentExchangeRate();
  const createSale = useCreateSale();
  const [customerId, setCustomerId] = useState("");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [discountRef, setDiscountRef] = useState(0);
  const [taxRef, setTaxRef] = useState(0);
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<CartItem[]>([]);
  const [formError, setFormError] = useState<string>();

  const customers = getPaginatedItems(contacts.data).filter(
    (contact) => contact.type === "cliente" || contact.type === "ambos",
  );
  const activeProducts = getPaginatedItems(products.data);
  const dependencyError = contacts.error ?? products.error ?? currentRate.error;
  const rateVes = currentRate.data?.rateVes ?? 0;
  const subtotalRef = useMemo(
    () => items.reduce((total, item) => total + item.quantity * item.unitPriceRef, 0),
    [items],
  );
  const totalRef = subtotalRef - discountRef + taxRef;
  const totalVes = rateVes ? refToVes(totalRef, rateVes) : 0;
  const selectedProduct = activeProducts.find((product) => product.id === productId);

  function handleAddItem() {
    setFormError(undefined);

    if (!selectedProduct) {
      setFormError("Selecciona un producto para agregarlo a la venta.");
      return;
    }

    if (quantity < 1) {
      setFormError("La cantidad debe ser mayor a cero.");
      return;
    }

    setItems((current) => {
      const existing = current.find((item) => item.productId === selectedProduct.id);

      if (existing) {
        return current.map((item) =>
          item.productId === selectedProduct.id
            ? { ...item, quantity: item.quantity + quantity }
            : item,
        );
      }

      return [
        ...current,
        {
          productId: selectedProduct.id,
          productName: selectedProduct.name,
          quantity,
          stock: selectedProduct.currentStock,
          unitPriceRef: selectedProduct.salePriceRef,
        },
      ];
    });
    setProductId("");
    setQuantity(1);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(undefined);

    if (!customerId) {
      setFormError("Selecciona un cliente para registrar la venta.");
      return;
    }

    if (items.length === 0) {
      setFormError("Agrega al menos un producto a la venta.");
      return;
    }

    const input: SaleCreateInput = {
      customerId,
      discountRef,
      items: items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
      })),
      notes: notes || undefined,
      refRateVes: rateVes || undefined,
      taxRef,
    };

    await createSale.mutateAsync(input);
  }

  return (
    <form className="space-y-5 pb-24 lg:pb-6" onSubmit={handleSubmit}>
      <PageHeader
        actions={
          <>
            <Button asChild className="w-full sm:w-auto" variant="outline">
              <Link href="/sales">Volver</Link>
            </Button>
            <Button
              className="hidden w-full sm:w-auto lg:inline-flex"
              disabled={createSale.isPending}
              type="submit"
            >
              {createSale.isPending ? "Registrando..." : "Registrar venta"}
            </Button>
          </>
        }
        badge={<p className="text-sm font-medium text-blue-600">Ventas</p>}
        description="Crea una venta usando clientes, productos activos y la tasa vigente."
        title="Nueva venta"
      />

      {formError || createSale.error ? (
        <ErrorState
          description={
            formError ??
            (createSale.error instanceof Error
              ? createSale.error.message
              : "No pudimos registrar la venta.")
          }
          title="Revisa la venta"
        />
      ) : null}

      {dependencyError ? (
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
      ) : null}

      {createSale.data ? (
        <Card>
          <CardHeader>
            <CardTitle>Venta registrada</CardTitle>
            <CardDescription>
              La API respondio con la venta {createSale.data.invoiceNumber}.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button asChild size="sm">
              <Link href="/sales">Volver al listado</Link>
            </Button>
          </CardFooter>
        </Card>
      ) : null}

      <div className="grid min-w-0 gap-5 lg:grid-cols-[1fr_24rem]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Cliente y productos</CardTitle>
              <CardDescription>
                Selecciona el cliente y arma el carrito antes de registrar.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <SelectField
                disabled={contacts.isLoading}
                helperText={
                  !contacts.isLoading && customers.length === 0
                    ? "No hay clientes activos disponibles."
                    : undefined
                }
                label="Cliente"
                onChange={(event) => setCustomerId(event.target.value)}
                options={customers.map((contact) => ({
                  label: contact.name,
                  value: contact.id,
                }))}
                placeholder={contacts.isLoading ? "Cargando clientes..." : "Selecciona cliente"}
                value={customerId}
              />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-[1fr_9rem_auto] md:items-end">
                <div className="sm:col-span-2 md:col-span-1">
                <SelectField
                  disabled={products.isLoading}
                  helperText={
                    !products.isLoading && activeProducts.length === 0
                      ? "No hay productos activos disponibles."
                      : undefined
                  }
                  label="Producto"
                  onChange={(event) => setProductId(event.target.value)}
                  options={activeProducts.map((product) => ({
                    label: `${product.name} - ${formatRef(product.salePriceRef)}`,
                    value: product.id,
                  }))}
                  placeholder={products.isLoading ? "Cargando productos..." : "Selecciona"}
                  value={productId}
                />
                </div>
                <Input
                  label="Cantidad"
                  min={1}
                  onChange={(event) => setQuantity(Number(event.target.value))}
                  type="number"
                  value={quantity}
                />
                <Button className="w-full md:w-auto" onClick={handleAddItem} type="button">
                  Agregar
                </Button>
              </div>
            </CardContent>
          </Card>

          <DataTable
            actions={(item) => [
              {
                label: "Quitar",
                onSelect: () =>
                  setItems((current) =>
                    current.filter((candidate) => candidate.productId !== item.productId),
                  ),
                variant: "danger",
              },
            ]}
            cardTitle={(item) => item.productName}
            columns={itemColumns}
            data={items}
            emptyState={
              <EmptyState
                description="Agrega productos activos para calcular los totales."
                title="La venta no tiene productos"
              />
            }
            getRowId={(item) => item.productId}
          />
        </div>

        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Totales</CardTitle>
              <CardDescription>
                Tasa vigente: {rateVes ? formatVes(rateVes) : "cargando..."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                label="Descuento ref"
                min={0}
                onChange={(event) => setDiscountRef(Number(event.target.value))}
                step="0.01"
                type="number"
                value={discountRef}
              />
              <Input
                label="Impuesto ref"
                min={0}
                onChange={(event) => setTaxRef(Number(event.target.value))}
                step="0.01"
                type="number"
                value={taxRef}
              />
              <Textarea
                label="Notas"
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Observaciones internas"
                value={notes}
              />
              <dl className="space-y-3 rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-950">
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500 dark:text-slate-400">Subtotal</dt>
                  <dd className="font-medium text-slate-950 dark:text-slate-100">
                    {formatRef(subtotalRef)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500 dark:text-slate-400">Total ref</dt>
                  <dd className="font-medium text-slate-950 dark:text-slate-100">
                    {formatRef(totalRef)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500 dark:text-slate-400">Total VES</dt>
                  <dd className="font-semibold text-slate-950 dark:text-slate-100">
                    {formatVes(totalVes)}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 lg:hidden">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-slate-500 dark:text-slate-400">Total ref</p>
            <p className="truncate text-lg font-semibold">{formatRef(totalRef)}</p>
          </div>
          <Button className="shrink-0" disabled={createSale.isPending} type="submit">
            {createSale.isPending ? "Registrando..." : "Registrar venta"}
          </Button>
        </div>
      </div>
    </form>
  );
}
