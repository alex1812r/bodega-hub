"use client";

import { CheckCircle2, Trash2, UserRound, X } from "lucide-react";
import { useState } from "react";

import type { ContactMock, PaymentMethod } from "@/shared/mocks/erp-data";
import { Button } from "@/shared/components/Button";
import { EmptyState } from "@/shared/components/EmptyState";
import { formatRef, formatRefUsd, formatVes } from "@/shared/utils/currency";
import { cn } from "@/shared/utils/cn";

import type { PosCartItem } from "../hooks/usePosCart";
import {
  canUseMixedPayments,
  isUsdPaymentMethod,
  methodRequiresPaymentDetails,
  type PosMixedPaymentLine,
  type PosSinglePaymentDetails,
} from "../utils/mixedPayments";
import { PosCartLine } from "./PosCartLine";
import { PosCustomerPickerModal } from "./PosCustomerPickerModal";
import { PosMixedPaymentsModal } from "./PosMixedPaymentsModal";
import {
  PosPaymentMethods,
  posPaymentMethodLabels,
} from "./PosPaymentMethods";

type PosCartPanelProps = {
  className?: string;
  customerId: string;
  customers: ContactMock[];
  enabledPaymentMethods: PaymentMethod[];
  isSubmitting?: boolean;
  items: PosCartItem[];
  itemsCount: number;
  mixedPayments: PosMixedPaymentLine[] | null;
  onClearMixedPayments: () => void;
  onClearOrder: () => void;
  onCustomerChange: (customerId: string) => void;
  onEditPaymentDetails?: () => void;
  onMixedPaymentsChange: (lines: PosMixedPaymentLine[]) => void;
  onPaymentMethodChange: (method: PaymentMethod) => void;
  onProcessSale: () => void;
  onQuantityChange: (productId: string, quantity: number) => void;
  onRemoveItem: (productId: string) => void;
  onRequestClose?: () => void;
  paymentDetails?: PosSinglePaymentDetails | null;
  paymentMethod: PaymentMethod | null;
  rateVes: number;
  subtotalRef: number;
  totalRef: number;
  totalVes: number;
};

export function PosCartPanel({
  className,
  customerId,
  customers,
  enabledPaymentMethods,
  isSubmitting = false,
  items,
  itemsCount,
  mixedPayments,
  onClearMixedPayments,
  onClearOrder,
  onCustomerChange,
  onEditPaymentDetails,
  onMixedPaymentsChange,
  onPaymentMethodChange,
  onProcessSale,
  onQuantityChange,
  onRemoveItem,
  onRequestClose,
  paymentDetails = null,
  paymentMethod,
  rateVes,
  subtotalRef,
  totalRef,
  totalVes,
}: PosCartPanelProps) {
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [mixedModalOpen, setMixedModalOpen] = useState(false);
  const selectedCustomer = customers.find((customer) => customer.id === customerId);
  const hasMixedPayments = Boolean(mixedPayments && mixedPayments.length > 0);
  const mixedPaymentsAvailable = canUseMixedPayments(enabledPaymentMethods);
  const hasSingleMethodDetails =
    !hasMixedPayments &&
    paymentMethod != null &&
    methodRequiresPaymentDetails(paymentMethod) &&
    Boolean(paymentDetails);
  const canProcessSale =
    items.length > 0 && (hasMixedPayments || paymentMethod != null);

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
        <div className="flex shrink-0 items-center gap-1">
          <button
            aria-label="Limpiar orden"
            className="cursor-pointer rounded-lg p-2 text-muted-foreground transition-colors hover:bg-surface-container hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
            disabled={items.length === 0}
            onClick={onClearOrder}
            type="button"
          >
            <Trash2 aria-hidden className="size-5" />
          </button>
          {onRequestClose ? (
            <button
              aria-label="Cerrar carrito"
              className="cursor-pointer rounded-lg p-2 text-muted-foreground transition-colors hover:bg-surface-container hover:text-foreground"
              onClick={onRequestClose}
              type="button"
            >
              <X aria-hidden className="size-5" />
            </button>
          ) : null}
        </div>
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
        <PosPaymentMethods
          disabled={hasMixedPayments}
          enabledMethods={enabledPaymentMethods}
          onChange={onPaymentMethodChange}
          onOpenMixedPayments={
            mixedPaymentsAvailable ? () => setMixedModalOpen(true) : undefined
          }
          selectedMethod={paymentMethod}
          showMixedPaymentsLink={mixedPaymentsAvailable || hasMixedPayments}
        />

        {hasMixedPayments && mixedPayments ? (
          <div className="space-y-2 rounded-lg border border-border bg-surface-container-low px-3 py-2 dark:border-slate-700">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-foreground">Pago mixto</p>
              <button
                className="cursor-pointer text-xs font-medium text-destructive hover:underline"
                onClick={onClearMixedPayments}
                type="button"
              >
                Quitar
              </button>
            </div>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {mixedPayments.map((line) => (
                <li className="flex justify-between gap-2" key={line.id}>
                  <span>{posPaymentMethodLabels[line.method]}</span>
                  <span className="font-medium text-foreground">
                    {isUsdPaymentMethod(line.method)
                      ? formatRefUsd(line.amount)
                      : formatVes(line.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {hasSingleMethodDetails && paymentMethod && paymentDetails ? (
          <div className="space-y-2 rounded-lg border border-border bg-surface-container-low px-3 py-2 dark:border-slate-700">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-foreground">
                Datos de {posPaymentMethodLabels[paymentMethod]}
              </p>
              {onEditPaymentDetails ? (
                <button
                  className="cursor-pointer text-xs font-medium text-primary hover:underline"
                  onClick={onEditPaymentDetails}
                  type="button"
                >
                  Editar
                </button>
              ) : null}
            </div>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>Banco: {paymentDetails.bankName}</li>
              {paymentDetails.phone ? <li>Telefono: {paymentDetails.phone}</li> : null}
              <li>Referencia: {paymentDetails.referenceCode}</li>
            </ul>
          </div>
        ) : null}

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
          className="w-full gap-2 border-transparent bg-[var(--secondary)] text-white hover:bg-[color-mix(in_srgb,var(--secondary)_85%,black)] hover:text-white"
          disabled={isSubmitting || !canProcessSale}
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

      <PosMixedPaymentsModal
        enabledPaymentMethods={enabledPaymentMethods}
        initialLines={mixedPayments}
        onConfirm={onMixedPaymentsChange}
        onOpenChange={setMixedModalOpen}
        open={mixedModalOpen}
        rateVes={rateVes}
        totalRef={totalRef}
        totalVes={totalVes}
      />
    </aside>
  );
}
