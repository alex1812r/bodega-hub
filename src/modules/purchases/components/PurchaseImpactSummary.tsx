"use client";

import { ArrowRight, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { paymentMethodLabels } from "@/modules/payments/payment-details/utils/paymentDetailLabels";
import { Badge } from "@/shared/components/Badge";
import { Button } from "@/shared/components/Button";
import {
  ConfirmActionModal,
  type ConfirmActionStatus,
} from "@/shared/components/ConfirmActionModal";
import type { ImpactPaymentLine } from "@/shared/impact/types";
import type { PurchaseStatus } from "@/shared/mocks/erp-data";
import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";

import { usePurchaseImpact } from "../hooks/usePurchaseImpact";
import type {
  PurchaseImpact,
  PurchaseImpactBlockingProduct,
  PurchaseImpactStockLine,
} from "../services/purchaseImpact";

export const PURCHASE_STATUS_LABEL: Record<PurchaseStatus, string> = {
  cancelado: "Cancelado",
  devuelto: "Devuelto",
  pedido: "Pedido · sin recibir",
  recibido: "Recibido",
};

const noticeClassName =
  "flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300";
const sectionTitleClassName =
  "pt-2 text-xs font-semibold uppercase tracking-wide text-on-surface-variant";
const blockedSectionClassName =
  "overflow-hidden rounded-md border border-border bg-surface-container-low";
const blockedSectionTitleClassName =
  "border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-on-surface-variant";

export function formatPurchaseImpactNumber(number: string) {
  return number.startsWith("#") ? number : `#${number}`;
}

/** Aviso ámbar con icono: el texto se muestra tal cual. */
export function PurchaseImpactNotice({ children }: { children: ReactNode }) {
  return (
    <p className={noticeClassName} role="note">
      <TriangleAlert aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

/** «antes → después», legible también sin ver la flecha. */
export function PurchaseImpactBeforeAfter({
  after,
  before,
}: {
  after: ReactNode;
  before: ReactNode;
}) {
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1.5 tabular-nums">
      <span className="text-on-surface-variant">{before}</span>
      <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-on-surface-variant" />
      <span className="sr-only">pasa a</span>
      <span className="font-semibold text-foreground">{after}</span>
    </span>
  );
}

function formatSignedUnits(quantity: number) {
  return `${quantity < 0 ? "−" : "+"}${Math.abs(quantity)} un`;
}

function ProductName({ name, sku }: { name: string | null; sku: string | null }) {
  return (
    <span className="min-w-0 break-words font-medium text-foreground">
      {name ?? "Producto que ya no existe"}
      {sku ? (
        <span className="ml-1.5 font-mono text-xs font-normal text-on-surface-variant">{sku}</span>
      ) : null}
    </span>
  );
}

function StockLine({ line }: { line: PurchaseImpactStockLine }) {
  const hasFigures = line.stockBefore !== null && line.stockAfter !== null;

  return (
    <li className="space-y-1.5 py-2 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <ProductName name={line.productName} sku={line.sku} />
        {hasFigures && line.quantityDelta !== 0 ? (
          <span className="shrink-0 font-semibold tabular-nums text-foreground">
            {formatSignedUnits(line.quantityDelta)}
          </span>
        ) : null}
      </div>

      {hasFigures ? (
        <p className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
          <span className="text-on-surface-variant">Stock</span>
          {line.quantityDelta === 0 ? (
            <span className="tabular-nums text-on-surface-variant">
              {line.stockBefore} un (no cambia: no quedan unidades por sacar)
            </span>
          ) : (
            <PurchaseImpactBeforeAfter
              after={`${line.stockAfter} un`}
              before={`${line.stockBefore} un`}
            />
          )}
        </p>
      ) : null}

      {line.isActive === false ? (
        <PurchaseImpactNotice>Producto inactivo: su stock sale igual.</PurchaseImpactNotice>
      ) : null}
      {line.inexact ? <PurchaseImpactNotice>{line.inexact.reason}</PurchaseImpactNotice> : null}
    </li>
  );
}

function paymentAmountLabel(payment: ImpactPaymentLine) {
  return payment.currency === "USD"
    ? `${formatRefUsd(payment.amount)} (${formatVesBs(payment.amountVes)})`
    : formatVesBs(payment.amount);
}

/** Pagos de la compra con lo que la acción hace con cada uno (ninguna mueve dinero). */
export function PurchaseImpactPayments({
  label,
  payments,
}: {
  label: string;
  payments: ImpactPaymentLine[];
}) {
  return (
    <ul aria-label={label} className="divide-y divide-border">
      {payments.map((payment) => (
        <li className="space-y-1.5 py-2 text-sm" key={payment.paymentId}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="min-w-0 break-words font-medium text-foreground">
              {paymentMethodLabels[payment.method]}
            </span>
            <span className="shrink-0 font-semibold tabular-nums text-foreground">
              {paymentAmountLabel(payment)}
            </span>
          </div>
          {payment.outcome === "blocks_action" ? (
            <Badge variant="danger">Hay que anularlo antes</Badge>
          ) : payment.outcome === "already_cancelled" ? (
            <Badge variant="default">Ya anulado</Badge>
          ) : null}
          <p className="break-words text-xs text-on-surface-variant">{payment.description}</p>
          {payment.inexact ? (
            <PurchaseImpactNotice>{payment.inexact.reason}</PurchaseImpactNotice>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Productos por los que la RPC rechaza la acción: cuánto hay, cuánto hace falta y cuánto falta. */
export function PurchaseImpactBlockingProducts({
  products,
}: {
  products: PurchaseImpactBlockingProduct[];
}) {
  return (
    <section aria-label="Productos que lo impiden" className={blockedSectionClassName}>
      <h3 className={blockedSectionTitleClassName}>Productos que lo impiden</h3>
      <ul
        aria-label="Productos sin stock suficiente"
        className="max-h-56 divide-y divide-border overflow-y-auto px-3"
      >
        {products.map((product) => {
          const hasFigures = product.available !== null && product.required !== null;
          const missing = hasFigures ? (product.required ?? 0) - (product.available ?? 0) : 0;

          return (
            <li className="space-y-1 py-2 text-sm" key={product.productId}>
              <ProductName name={product.productName} sku={product.sku} />
              {hasFigures ? (
                <p className="break-words text-xs tabular-nums text-on-surface-variant">
                  Hay {product.available} un y tienen que salir {product.required} un
                  {missing > 0 ? (
                    <>
                      :{" "}
                      <span className="font-semibold text-foreground">
                        {missing === 1 ? "falta 1 un" : `faltan ${missing} un`}
                      </span>
                    </>
                  ) : null}
                  .
                </p>
              ) : (
                <p className="text-xs text-on-surface-variant">
                  No se puede leer su stock en esta tienda.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Efecto de cancelar o devolver una compra, tal como lo calculó el impact: lo
 * que sale del inventario (antes → después), que no se mueve dinero y que el
 * costo no se revierte. No calcula nada: solo presenta.
 */
export function PurchaseImpactEffects({ impact }: { impact: PurchaseImpact }) {
  const wasReceived = impact.document.status === "recibido";

  return (
    <div className="space-y-1 pb-2">
      <h4 className={sectionTitleClassName}>Inventario</h4>
      {impact.stock.length > 0 ? (
        <ul aria-label="Productos que salen del inventario" className="divide-y divide-border">
          {impact.stock.map((line) => (
            <StockLine key={line.productId} line={line} />
          ))}
        </ul>
      ) : (
        <p className="py-2 text-sm text-on-surface-variant">
          {wasReceived
            ? "La compra no tiene productos: el inventario no cambia."
            : "El inventario no cambia: la mercancía de este pedido no se había recibido."}
        </p>
      )}

      <h4 className={sectionTitleClassName}>Pagos</h4>
      {impact.paymentsRestricted ? (
        <p className="py-2 text-sm text-on-surface-variant">
          Tu usuario no ve los pagos de las compras. Esta acción no mueve dinero.
        </p>
      ) : impact.payments.length > 0 ? (
        <>
          <p className="pt-2 text-sm text-on-surface-variant">
            No hay pagos activos: esta acción no mueve dinero.
          </p>
          <PurchaseImpactPayments label="Pagos de la compra" payments={impact.payments} />
        </>
      ) : (
        <p className="py-2 text-sm text-on-surface-variant">
          Sin pagos registrados: esta acción no mueve dinero.
        </p>
      )}

      {wasReceived ? (
        <PurchaseImpactNotice>
          El costo de los productos no se revierte: queda el que fijó la recepción de esta compra.
        </PurchaseImpactNotice>
      ) : null}
    </div>
  );
}

/** Cabecera del documento afectado: número, proveedor y estado antes → después. */
export function PurchaseImpactDocumentSummary({ impact }: { impact: PurchaseImpact }) {
  const { document } = impact;

  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        <dt className="text-on-surface-variant">Compra</dt>
        <dd className="min-w-0 break-words text-right font-medium text-foreground">
          {formatPurchaseImpactNumber(document.number)}
        </dd>
        <dt className="text-on-surface-variant">Proveedor</dt>
        <dd className="min-w-0 break-words text-right font-medium text-foreground">
          {document.contactName ?? "Sin proveedor"}
        </dd>
        <dt className="text-on-surface-variant">Estado</dt>
        <dd className="text-right">
          {document.statusAfter === document.status ? (
            <span className="font-medium text-foreground">
              {PURCHASE_STATUS_LABEL[document.status]}
            </span>
          ) : (
            <PurchaseImpactBeforeAfter
              after={PURCHASE_STATUS_LABEL[document.statusAfter]}
              before={PURCHASE_STATUS_LABEL[document.status]}
            />
          )}
        </dd>
      </dl>
      {impact.inexact ? <PurchaseImpactNotice>{impact.inexact.reason}</PurchaseImpactNotice> : null}
    </div>
  );
}

export type PurchaseImpactConfirmModalProps = {
  /** Mensaje del servidor si la acción falla al ejecutarse; se muestra tal cual. */
  error?: string | null;
  isPending?: boolean;
  /** Ejecuta la acción. Solo se puede llamar con el efecto a la vista y permitido. */
  onConfirm: () => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  /**
   * Enlace a los pagos de la compra (con `returnTo`); se ofrece cuando un pago
   * activo impide la acción y la sesión puede ver pagos.
   */
  paymentsHref?: string;
  purchaseId?: string;
};

type PurchaseImpactConfirmShellProps = PurchaseImpactConfirmModalProps & {
  action: "cancel" | "return";
  blockedTitle: string;
  confirmLabel: string;
  description: string;
  title: string;
};

function ImpactGate({
  action,
  blockedTitle,
  confirmLabel,
  description,
  error,
  isPending,
  onConfirm,
  onOpenChange,
  paymentsHref,
  purchaseId,
  title,
}: Omit<PurchaseImpactConfirmShellProps, "open">) {
  const query = usePurchaseImpact({ action, enabled: true, purchaseId });
  // Solo vale una respuesta al día: mientras se reintenta no hay efecto que confirmar.
  const impact = query.isSuccess && !query.isFetching ? (query.data ?? null) : null;
  const blocking =
    impact && !impact.allowed
      ? impact.payments.filter((payment) => payment.outcome === "blocks_action")
      : [];
  const hasBlockingPayments = blocking.length > 0;
  const blockingProducts = impact && !impact.allowed ? impact.blockingProducts : [];

  let status: ConfirmActionStatus = "loading";
  let statusMessage = "Calculando qué va a pasar con el inventario…";

  if (impact) {
    status = impact.allowed ? "ready" : "blocked";
    statusMessage = impact.reason ?? "";
  } else if (!query.isFetching && (query.isError || query.isSuccess)) {
    status = "error";
    statusMessage = query.error instanceof Error ? query.error.message : "";
  }

  // Un solo diálogo de principio a fin: sin efecto permitido a la vista no hay
  // botón de confirmar (lo decide `status`).
  return (
    <ConfirmActionModal
      blockedActions={
        hasBlockingPayments && paymentsHref ? (
          <Button asChild>
            <Link href={paymentsHref}>Ver pagos de la compra</Link>
          </Button>
        ) : undefined
      }
      confirmLabel={confirmLabel}
      description={
        status === "blocked"
          ? "La acción no se puede ejecutar ahora. No se ha cambiado nada."
          : description
      }
      error={error}
      isPending={isPending}
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
      onRetry={() => void query.refetch()}
      open
      renderEffects={impact ? () => <PurchaseImpactEffects impact={impact} /> : undefined}
      status={status}
      statusHint={
        status === "error"
          ? "Sin el efecto a la vista no se puede confirmar. No se ha cambiado nada."
          : undefined
      }
      statusMessage={statusMessage}
      title={status === "blocked" ? blockedTitle : title}
      variant="danger"
    >
      {impact ? (
        <div className="flex flex-col gap-4">
          <PurchaseImpactDocumentSummary impact={impact} />
          {hasBlockingPayments ? (
            <>
              <section aria-label="Pagos que lo impiden" className={blockedSectionClassName}>
                <h3 className={blockedSectionTitleClassName}>Pagos que hay que anular antes</h3>
                <div className="max-h-56 overflow-y-auto px-3 py-1">
                  <PurchaseImpactPayments label="Pagos que lo impiden" payments={blocking} />
                </div>
              </section>
              <p>
                Esta acción no revierte pagos. Anula antes cada pago activo y vuelve a intentarlo.
              </p>
            </>
          ) : null}
          {!impact.allowed && impact.paymentsRestricted ? (
            <PurchaseImpactNotice>
              Tu usuario no ve los pagos de las compras. Si el motivo son pagos activos, pide a un
              administrador o contador que los anule antes.
            </PurchaseImpactNotice>
          ) : null}
          {blockingProducts.length > 0 ? (
            <PurchaseImpactBlockingProducts products={blockingProducts} />
          ) : null}
        </div>
      ) : null}
    </ConfirmActionModal>
  );
}

/**
 * Confirmación de cancelar o devolver una compra con su efecto real (CNF-05).
 *
 * Pide el impact al abrirse (cada apertura lo recalcula). Es un único
 * `ConfirmActionModal` de principio a fin: solo ofrece confirmar cuando el
 * efecto llegó y la RPC lo permitiría; mientras carga, si falla o si la RPC lo
 * rechazaría (pago activo, stock insuficiente), queda de solo lectura.
 */
export function PurchaseImpactConfirmModal({ open, ...props }: PurchaseImpactConfirmShellProps) {
  return open ? <ImpactGate {...props} /> : null;
}
