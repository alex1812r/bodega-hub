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
import type {
  ImpactMethodAmount,
  ImpactMoneyEffect,
  ImpactMoneyTarget,
  ImpactPaymentLine,
  ImpactPaymentOutcome,
  ImpactStockLine,
} from "@/shared/impact/types";
import type { SaleStatus } from "@/shared/mocks/erp-data";
import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";

import { useSaleImpact } from "../hooks/useSaleImpact";
import type { SaleImpact, SaleImpactAction } from "../services/saleImpact";

const SALE_STATUS_LABEL: Record<SaleStatus, string> = {
  borrador: "Borrador",
  cancelada: "Anulada",
  devuelta: "Devuelta",
  pagada: "Pagada",
  pendiente_pago: "Pendiente de pago",
};

const MONEY_TARGET_LABEL: Record<Exclude<ImpactMoneyTarget, "caja">, string> = {
  baul_cuenta: "Baúl (cuenta)",
  baul_efectivo_ves: "Baúl (efectivo Bs)",
  baul_ref: "Baúl (efectivo USD)",
};

const PAYMENT_OUTCOME_BADGE: Record<
  ImpactPaymentOutcome,
  { label: string; variant: "danger" | "default" | "warning" }
> = {
  already_cancelled: { label: "Ya anulado", variant: "default" },
  blocks_action: { label: "Hay que anularlo antes", variant: "danger" },
  reverted: { label: "Se anula", variant: "warning" },
  unchanged: { label: "No se toca", variant: "default" },
};

const noticeClassName =
  "flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300";
const sectionTitleClassName =
  "pt-2 text-xs font-semibold uppercase tracking-wide text-on-surface-variant";

function formatInvoice(number: string) {
  return number.startsWith("#") ? number : `#${number}`;
}

function formatMoney(value: number, currency: "USD" | "VES") {
  return currency === "USD" ? formatRefUsd(value) : formatVesBs(value);
}

function formatSignedMoney(value: number, currency: "USD" | "VES") {
  return `${value < 0 ? "−" : "+"} ${formatMoney(Math.abs(value), currency)}`;
}

function formatSignedUnits(quantity: number) {
  return `${quantity < 0 ? "−" : "+"}${Math.abs(quantity)} und`;
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p className={noticeClassName} role="note">
      <TriangleAlert aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

function BeforeAfter({ after, before }: { after: string; before: string }) {
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1.5 tabular-nums">
      <span className="text-on-surface-variant">{before}</span>
      <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-on-surface-variant" />
      <span className="sr-only">pasa a</span>
      <span className="font-semibold text-foreground">{after}</span>
    </span>
  );
}

function StockLine({ line }: { line: ImpactStockLine }) {
  const name = line.productName ?? "Producto que ya no existe";
  const hasFigures = line.stockBefore !== null && line.stockAfter !== null;

  return (
    <li className="space-y-1.5 py-2 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="min-w-0 break-words font-medium text-foreground">
          {name}
          {line.sku ? (
            <span className="ml-1.5 font-mono text-xs font-normal text-on-surface-variant">
              {line.sku}
            </span>
          ) : null}
        </span>
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
              {line.stockBefore} und (no cambia: no quedan unidades por reponer)
            </span>
          ) : (
            <BeforeAfter after={`${line.stockAfter} und`} before={`${line.stockBefore} und`} />
          )}
        </p>
      ) : null}

      {line.isActive === false ? (
        <Notice>Producto inactivo: su stock se repone igual.</Notice>
      ) : null}
      {line.inexact ? <Notice>{line.inexact.reason}</Notice> : null}
    </li>
  );
}

function MoneyEffect({ effect }: { effect: ImpactMoneyEffect }) {
  const target =
    effect.target === "caja"
      ? `Caja «${effect.targetName ?? "sin nombre"}»`
      : MONEY_TARGET_LABEL[effect.target];

  return (
    <li className="space-y-1 rounded-md bg-surface-container px-2.5 py-1.5 text-xs">
      <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="min-w-0 break-words text-foreground">{target}</span>
        <span className="shrink-0 font-semibold tabular-nums text-foreground">
          {formatSignedMoney(effect.delta, effect.currency)}
        </span>
      </p>
      {effect.balanceBefore !== null && effect.balanceAfter !== null ? (
        <p className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
          <span className="text-on-surface-variant">Saldo</span>
          <BeforeAfter
            after={formatMoney(effect.balanceAfter, effect.currency)}
            before={formatMoney(effect.balanceBefore, effect.currency)}
          />
        </p>
      ) : null}
      {effect.physical ? null : (
        <p className="text-on-surface-variant">
          Asiento informativo de la sesión: no mueve el efectivo de la gaveta.
        </p>
      )}
      {effect.note ? <p className="text-amber-800 dark:text-amber-300">{effect.note}</p> : null}
    </li>
  );
}

function paymentAmountLabel(payment: ImpactPaymentLine) {
  const amount = formatMoney(payment.amount, payment.currency);

  return payment.currency === "USD" ? `${amount} (${formatVesBs(payment.amountVes)})` : amount;
}

function PaymentLine({ payment }: { payment: ImpactPaymentLine }) {
  const badge = PAYMENT_OUTCOME_BADGE[payment.outcome];

  return (
    <li className="space-y-1.5 py-2 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="min-w-0 break-words font-medium text-foreground">
          {paymentMethodLabels[payment.method]}
        </span>
        <span className="shrink-0 font-semibold tabular-nums text-foreground">
          {paymentAmountLabel(payment)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge variant={badge.variant}>{badge.label}</Badge>
        {payment.changeVes > 0 ? (
          <span className="text-xs tabular-nums text-on-surface-variant">
            Vuelto entregado: {formatVesBs(payment.changeVes)}
          </span>
        ) : null}
      </div>
      <p className="break-words text-xs text-on-surface-variant">{payment.description}</p>
      {payment.effects.length > 0 ? (
        <ul
          aria-label={`Asientos que revierte el pago por ${paymentMethodLabels[payment.method]}`}
          className="space-y-1"
        >
          {payment.effects.map((effect, index) => (
            <MoneyEffect effect={effect} key={`${index}-${effect.target}-${effect.currency}`} />
          ))}
        </ul>
      ) : null}
      {payment.inexact ? <Notice>{payment.inexact.reason}</Notice> : null}
    </li>
  );
}

function MethodAmounts({ amounts, label }: { amounts: ImpactMethodAmount[]; label: string }) {
  return (
    <ul aria-label={label} className="divide-y divide-border">
      {amounts.map((entry) => (
        <li
          className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5 text-sm"
          key={entry.method}
        >
          <span className="min-w-0 break-words text-foreground">
            {paymentMethodLabels[entry.method]}
          </span>
          <span className="shrink-0 font-semibold tabular-nums text-foreground">
            {entry.currency === "USD"
              ? `${formatRefUsd(entry.amount)} (${formatVesBs(entry.amountVes)})`
              : formatVesBs(entry.amount)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Lista de pagos de la venta con lo que la acción hace con cada uno. */
export function SaleImpactPayments({ payments }: { payments: ImpactPaymentLine[] }) {
  return (
    <ul aria-label="Pagos de la venta" className="divide-y divide-border">
      {payments.map((payment) => (
        <PaymentLine key={payment.paymentId} payment={payment} />
      ))}
    </ul>
  );
}

/**
 * Efecto de anular o devolver una venta, tal como lo calculó el impact: stock
 * que vuelve (antes → después), qué pasa con cada pago y, al devolver, el
 * dinero que sale por método. No calcula nada: solo presenta.
 */
export function SaleImpactEffects({ impact }: { impact: SaleImpact }) {
  const { refund } = impact;

  return (
    <div className="space-y-1 pb-2">
      <h4 className={sectionTitleClassName}>Productos que vuelven al stock</h4>
      {impact.stock.length > 0 ? (
        <ul aria-label="Productos que vuelven al stock" className="divide-y divide-border">
          {impact.stock.map((line) => (
            <StockLine key={line.productId} line={line} />
          ))}
        </ul>
      ) : (
        <p className="py-2 text-sm text-on-surface-variant">La venta no tiene productos.</p>
      )}

      <h4 className={sectionTitleClassName}>Pagos</h4>
      {impact.payments.length > 0 ? (
        <SaleImpactPayments payments={impact.payments} />
      ) : (
        <p className="py-2 text-sm text-on-surface-variant">
          Sin pagos registrados: nada que revertir.
        </p>
      )}

      {refund ? (
        <>
          <h4 className={sectionTitleClassName}>Dinero a devolver al cliente</h4>
          {refund.byMethod.length > 0 ? (
            <MethodAmounts amounts={refund.byMethod} label="Recibido del cliente por método" />
          ) : (
            <p className="py-2 text-sm text-on-surface-variant">
              No hay cobros activos: no se devuelve dinero.
            </p>
          )}
          {refund.changeToRecover.length > 0 ? (
            <>
              <p className="pt-1 text-xs text-on-surface-variant">
                Vuelto que se le entregó y se descuenta:
              </p>
              <MethodAmounts amounts={refund.changeToRecover} label="Vuelto entregado por método" />
            </>
          ) : null}
          <p className="flex flex-wrap items-baseline justify-between gap-x-3 border-t border-border py-2 text-sm">
            <span className="font-medium text-foreground">Neto a devolver</span>
            <span className="font-semibold tabular-nums text-foreground">
              {formatVesBs(refund.netVes)}
            </span>
          </p>
        </>
      ) : null}
    </div>
  );
}

/** Cabecera del documento afectado: número, cliente, estado y cobrado antes → después. */
export function SaleImpactDocumentSummary({ impact }: { impact: SaleImpact }) {
  const { document } = impact;

  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        <dt className="text-on-surface-variant">Venta</dt>
        <dd className="min-w-0 break-words text-right font-medium text-foreground">
          {formatInvoice(document.number)}
        </dd>
        <dt className="text-on-surface-variant">Cliente</dt>
        <dd className="min-w-0 break-words text-right font-medium text-foreground">
          {document.contactName ?? "Sin cliente"}
        </dd>
        <dt className="text-on-surface-variant">Estado</dt>
        <dd className="text-right">
          {document.statusAfter === document.status ? (
            <span className="font-medium text-foreground">
              {SALE_STATUS_LABEL[document.status]}
            </span>
          ) : (
            <BeforeAfter
              after={SALE_STATUS_LABEL[document.statusAfter]}
              before={SALE_STATUS_LABEL[document.status]}
            />
          )}
        </dd>
        <dt className="text-on-surface-variant">Cobrado</dt>
        <dd className="text-right">
          {impact.paidVesAfter === impact.paidVes ? (
            <span className="font-medium tabular-nums text-foreground">
              {formatVesBs(impact.paidVes)}
            </span>
          ) : (
            <BeforeAfter
              after={formatVesBs(impact.paidVesAfter)}
              before={formatVesBs(impact.paidVes)}
            />
          )}
        </dd>
      </dl>
      {impact.inexact ? <Notice>{impact.inexact.reason}</Notice> : null}
    </div>
  );
}

export type SaleImpactConfirmModalProps = {
  /** Mensaje del servidor si la acción falla al ejecutarse; se muestra tal cual. */
  error?: string | null;
  isPending?: boolean;
  /** Ejecuta la acción. Solo se puede llamar con el efecto a la vista y permitido. */
  onConfirm: () => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  /** Enlace a los pagos de la venta; se ofrece cuando un pago impide la acción. */
  paymentsHref?: string;
  saleId?: string;
};

type SaleImpactConfirmShellProps = SaleImpactConfirmModalProps & {
  action: SaleImpactAction;
  /** Salida extra cuando la acción no se puede ejecutar (p. ej. "Devolver la venta"). */
  blockedAlternative?: { hint: string; label: string; onSelect: () => void };
  blockedTitle: string;
  confirmLabel: string;
  description: string;
  title: string;
  /** Palabra a teclear cuando la venta tiene dinero cobrado. */
  typedWord: string;
};

function ImpactGate({
  action,
  blockedAlternative,
  blockedTitle,
  confirmLabel,
  description,
  error,
  isPending,
  onConfirm,
  onOpenChange,
  paymentsHref,
  saleId,
  title,
  typedWord,
}: Omit<SaleImpactConfirmShellProps, "open">) {
  const query = useSaleImpact({ action, enabled: true, saleId });
  // Solo vale una respuesta al día: mientras se reintenta no hay efecto que confirmar.
  const impact = query.isSuccess && !query.isFetching ? query.data : null;
  const blocking =
    impact && !impact.allowed
      ? impact.payments.filter((payment) => payment.outcome === "blocks_action")
      : [];
  const hasBlockingPayments = blocking.length > 0;

  let status: ConfirmActionStatus = "loading";
  let statusMessage = "Calculando qué va a pasar con el stock y los pagos…";

  if (impact) {
    status = impact.allowed ? "ready" : "blocked";
    statusMessage = impact.reason ?? "";
  } else if (query.isError && !query.isFetching) {
    status = "error";
    statusMessage = query.error instanceof Error ? query.error.message : "";
  }

  // Un solo diálogo de principio a fin: sin efecto permitido a la vista no hay
  // botón de confirmar (lo decide `status`).
  return (
    <ConfirmActionModal
      blockedActions={
        hasBlockingPayments ? (
          <>
            {blockedAlternative ? (
              <Button onClick={blockedAlternative.onSelect} type="button" variant="outline">
                {blockedAlternative.label}
              </Button>
            ) : null}
            {paymentsHref ? (
              <Button asChild>
                <Link href={paymentsHref}>Ver pagos de la venta</Link>
              </Button>
            ) : null}
          </>
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
      renderEffects={impact ? () => <SaleImpactEffects impact={impact} /> : undefined}
      requireTypedConfirmation={impact && impact.paidVes > 0 ? typedWord : undefined}
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
          <SaleImpactDocumentSummary impact={impact} />
          {hasBlockingPayments ? (
            <section
              aria-label="Pagos que lo impiden"
              className="overflow-hidden rounded-md border border-border bg-surface-container-low"
            >
              <h3 className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                Pagos que lo impiden
              </h3>
              <div className="px-3 py-1">
                <SaleImpactPayments payments={blocking} />
              </div>
            </section>
          ) : null}
          {hasBlockingPayments && blockedAlternative ? (
            <p>{blockedAlternative.hint}</p>
          ) : null}
        </div>
      ) : null}
    </ConfirmActionModal>
  );
}

/**
 * Confirmación de una acción sobre una venta con su efecto real (CNF-02/03).
 *
 * Pide el impact al abrirse (cada apertura lo recalcula). Es un único
 * `ConfirmActionModal` de principio a fin: solo ofrece confirmar cuando el
 * efecto llegó y la RPC lo permitiría; mientras carga, si falla o si la RPC lo
 * rechazaría, queda de solo lectura (no hay botón que vaya a fallar).
 */
export function SaleImpactConfirmModal({ open, ...props }: SaleImpactConfirmShellProps) {
  return open ? <ImpactGate {...props} /> : null;
}
