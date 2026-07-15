"use client";

import { CheckCircle2, Trash2, UserRound } from "lucide-react";
import { useState } from "react";

import type { ContactMock, PaymentMethod } from "@/shared/mocks/erp-data";
import { Button } from "@/shared/components/Button";
import { EmptyState } from "@/shared/components/EmptyState";
import { formatRef, formatVes } from "@/shared/utils/currency";
import { cn } from "@/shared/utils/cn";

import type { PosCartItem } from "../hooks/usePosCart";
import { PosCartLine } from "./PosCartLine";
import { PosCustomerPickerModal } from "./PosCustomerPickerModal";
import { PosPaymentMethods } from "./PosPaymentMethods";

type PosCartPanelProps = {
  className?: string;
  customerId: string;
  customers: ContactMock[];
  isSubmitting?: boolean;
  items: PosCartItem[];
  itemsCount: number;
  onClearOrder: () => void;
  onCustomerChange: (customerId: string) => void;
  onPaymentMethodChange: (method: PaymentMethod) => void;
  onProcessSale: () => void;
  onQuantityChange: (productId: string, quantity: number) => void;
  onRemoveItem: (productId: string) => void;
  paymentMethod: PaymentMethod;
  rateVes: number;
  subtotalRef: number;
  totalRef: number;
  totalVes: number;
};

export function PosCartPanel({
  className,
  customerId,
  customers,
  isSubmitting = false,
  items,
  itemsCount,
  onClearOrder,
  onCustomerChange,
  onPaymentMethodChange,
  onProcessSale,
  onQuantityChange,
  onRemoveItem,
  paymentMethod,
  rateVes,
  subtotalRef,
  totalRef,
  totalVes,
}: PosCartPanelProps) {
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const selectedCustomer = customers.find((customer) => customer.id === customerId);

  return (
    <aside
      className={cn(
        "flex min-h-0 w-full flex-1 flex-col overflow-hidden border-border bg-surface-container-lowest lg:border-l dark:border-slate-800",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3 dark:border-slate-800">
        <button
          className="inline-flex min-w-0 cursor-pointer items-center gap-2 text-left text-sm font-medium text-primary hover:underline"
          onClick={() => setCustomerModalOpen(true)}
          type="button"
        >
          <UserRound aria-hidden className="size-4 shrink-0" />
          <span className="truncate">
            {selectedCustomer ? selectedCustomer.name : "Seleccionar cliente"}
          </span>
        </button>
        <button
          aria-label="Limpiar orden"
          className="shrink-0 cursor-pointer rounded-lg p-2 text-muted-foreground transition-colors hover:bg-surface-container hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
          disabled={items.length === 0}
          onClick={onClearOrder}
          type="button"
        >
          <Trash2 aria-hidden className="size-5" />
        </button>
      </div>

      <div className="flex items-center justify-between border-b border-border px-4 py-2 dark:border-slate-800">
        <h2 className="text-base font-semibold text-foreground">Carrito</h2>
        <span className="text-xs font-medium text-muted-foreground">
          {itemsCount} {itemsCount === 1 ? "item" : "items"}
        </span>
      </div>

      <div className="h-0 min-h-0 flex-1 overflow-y-auto overscroll-contain bg-background px-3 py-2 sm:px-4">
        {items.length === 0 ? (
          <EmptyState
            className="py-10"
            description="Toca un producto del catalogo para agregarlo."
            title="Carrito vacio"
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <PosCartLine
                item={item}
                key={item.productId}
                onQuantityChange={onQuantityChange}
                onRemove={onRemoveItem}
                rateVes={rateVes}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="shrink-0 space-y-4 border-t border-border px-4 py-4 dark:border-slate-800">
        <PosPaymentMethods onChange={onPaymentMethodChange} selectedMethod={paymentMethod} />

        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-3 text-muted-foreground">
            <dt>Subtotal</dt>
            <dd className="font-medium text-foreground">{formatRef(subtotalRef)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="font-semibold text-foreground">Total</dt>
            <dd className="text-right">
              <p className="font-semibold text-foreground">{formatRef(totalRef)}</p>
              {rateVes > 0 ? (
                <p className="text-xs text-muted-foreground">{formatVes(totalVes)}</p>
              ) : null}
            </dd>
          </div>
        </dl>

        <Button
          className="w-full gap-2 bg-[var(--secondary)] text-white hover:opacity-90"
          disabled={isSubmitting || items.length === 0}
          onClick={onProcessSale}
          type="button"
          variant="primary"
        >
          <CheckCircle2 aria-hidden className="size-5" />
          {isSubmitting ? "Procesando..." : "Procesar venta"}
        </Button>
      </div>

      <PosCustomerPickerModal
        customers={customers}
        onOpenChange={setCustomerModalOpen}
        onSelect={onCustomerChange}
        open={customerModalOpen}
        selectedCustomerId={customerId}
      />
    </aside>
  );
}
