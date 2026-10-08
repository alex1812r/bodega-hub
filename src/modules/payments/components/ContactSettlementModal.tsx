"use client";

import { type ReactNode, useMemo, useRef, useState } from "react";

import { MAX_PAGE_LIMIT } from "@/lib/api/pagination";
import { useCurrentExchangeRate } from "@/modules/settings/hooks/useCurrentExchangeRate";
import { useEnabledPaymentMethods } from "@/modules/settings/hooks/useSettings";
import { ClientApiError } from "@/shared/api/apiFetch";
import { Badge } from "@/shared/components/Badge";
import { Button } from "@/shared/components/Button";
import { EmptyState } from "@/shared/components/EmptyState";
import { Modal } from "@/shared/components/Modal";
import {
  PaymentFormFields,
  type PaymentFormCurrency,
  type PaymentFormPayload,
  type PaymentFormValues,
  amountForMethodChange,
  buildPaymentFormPayload,
  createEmptyPaymentFormValues,
  getPaymentCurrency,
  isPaymentFormValid,
} from "@/shared/payments/PaymentFormFields";
import {
  DEFAULT_ENABLED_PAYMENT_METHODS,
  filterEnabledPaymentMethods,
  paymentMethodLabels,
} from "@/shared/payments/paymentMethods";
import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";
import { formatDate } from "@/shared/utils/date";

import { type OpenDocument, useOpenDocuments } from "../hooks/useOpenDocuments";
import { type PaymentDetail, useCreatePayment } from "../hooks/usePayments";
import { formatPurchaseNumberDisplay } from "../payments-list/utils/paymentReference";
import {
  MIN_PAYABLE_VES_BY_DOCUMENT,
  type PaymentAllocation,
  allocatePayment,
  maxAllocatableAmount,
} from "../utils/allocatePayment";

/**
 * Modal "Abonar": registra un abono de un contacto repartido entre sus documentos
 * con saldo, del más antiguo al más nuevo.
 *
 * 1. El usuario indica método y monto (y banco, teléfono y referencia si el método
 *    los pide: los mismos valen para todos los pagos del abono).
 * 2. Antes de confirmar ve el reparto: cuánto recibe cada documento y cuánto le queda.
 * 3. Al confirmar se registra UN pago por documento, uno tras otro. Si uno falla el
 *    abono se detiene: los ya registrados quedan y "Reintentar pendientes" continúa
 *    desde el que falló sin reenviar los anteriores.
 *
 * Nunca paga de más ni da vuelto: un monto mayor que lo abonable no se confirma.
 *
 * **Compras (`type="purchase"`):** montar este modal solo si el usuario puede pagar
 * compras (`canViewPurchasePayments(role)` de `@/shared/auth/paymentAccess`: admin y
 * contador). El modal no comprueba el rol; a un vendedor el servidor le responde 403.
 *
 * @example Botón en el detalle de un cliente
 * <ContactSettlementModal
 *   contactId={contact.id}
 *   contactName={contact.name}
 *   trigger={<Button>Abonar</Button>}
 *   type="sale"
 * />
 *
 * @example Apertura por código para un proveedor
 * {canViewPurchasePayments(role) ? (
 *   <ContactSettlementModal
 *     contactId={supplier.id}
 *     contactName={supplier.name}
 *     onOpenChange={setSettling}
 *     onSettled={() => setSettling(false)}
 *     open={settling}
 *     type="purchase"
 *   />
 * ) : null}
 */
export type ContactSettlementModalProps = {
  /** Contacto dueño de los documentos. Sale de la pantalla; el usuario nunca lo teclea. */
  contactId: string;
  /** Nombre del contacto, para los textos del modal. */
  contactName: string;
  /**
   * Se llama al abrirse y al cerrarse el modal por una acción del usuario. Con pagos
   * en vuelo el cierre se ignora y no se llama. Necesaria si se pasa `open`.
   */
  onOpenChange?: (open: boolean) => void;
  /**
   * Se llama una sola vez, cuando TODOS los pagos del abono quedaron registrados,
   * con los pagos que devolvió el servidor en el orden del reparto. No se llama si
   * el abono queda a medias. El modal no se cierra solo: muestra el resultado.
   */
  onSettled?: (payments: PaymentDetail[]) => void;
  /**
   * Apertura controlada: con un booleano el modal se abre y se cierra por código y
   * no pinta botón propio. Sin esta prop se abre con `trigger`.
   */
  open?: boolean;
  /**
   * Elemento que abre el modal al hacer clic. Sin `trigger` ni `open` se pinta un
   * botón "Abonar".
   */
  trigger?: ReactNode;
  /**
   * `"sale"`: cobra ventas por cobrar del cliente (entrada de dinero).
   * `"purchase"`: paga compras por pagar del proveedor (salida de dinero).
   */
  type: "purchase" | "sale";
};

type SettlementDocument = OpenDocument & {
  /** Tasa con la que el servidor convertirá un pago en USD a este documento. */
  rateVes: number;
};

type Allocation = PaymentAllocation<SettlementDocument>;

type RowStatus = "failed" | "pending" | "registered" | "registering";

type RunRow = {
  allocation: Allocation;
  /** Clave de idempotencia del pago de este documento: la misma en cada reintento. */
  clientRequestId: string;
  error?: Error;
  payment?: PaymentDetail;
  status: RowStatus;
  /** El fallo no dice si el pago se registró (red, 5xx, 408, 409). */
  uncertain?: boolean;
};

type Run = {
  currency: PaymentFormCurrency;
  payload: PaymentFormPayload;
  /** Pagos registrados en una ejecución anterior de este mismo abono (tras editar). */
  priorPayments: PaymentDetail[];
  rows: RunRow[];
};

type Step = "form" | "preview" | "run";

const TEXTS = {
  purchase: {
    description: (name: string) =>
      `Pago a ${name} repartido entre sus compras por pagar, de la más antigua a la más nueva.`,
    documents: (count: number) => (count === 1 ? "1 compra por pagar" : `${count} compras por pagar`),
    empty: (name: string) => `${name} no tiene compras por pagar.`,
    label: (number: string) => `Compra ${formatPurchaseNumberDisplay(number)}`,
  },
  sale: {
    description: (name: string) =>
      `Cobro a ${name} repartido entre sus ventas por cobrar, de la más antigua a la más nueva.`,
    documents: (count: number) => (count === 1 ? "1 venta por cobrar" : `${count} ventas por cobrar`),
    empty: (name: string) => `${name} no tiene ventas por cobrar.`,
    label: (number: string) => `Venta ${number}`,
  },
} as const;

const STATUS_BADGES: Record<
  RowStatus,
  { label: string; variant: "danger" | "default" | "info" | "success" }
> = {
  failed: { label: "Falló", variant: "danger" },
  pending: { label: "Pendiente", variant: "default" },
  registered: { label: "Registrado", variant: "success" },
  registering: { label: "Registrando…", variant: "info" },
};

const noticeClassName =
  "rounded-md bg-indigo-50 px-3 py-2 text-sm text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300";
const errorClassName =
  "min-w-0 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 [overflow-wrap:anywhere] dark:bg-red-950 dark:text-red-300";

/**
 * Mismo criterio que `RequestAttempt`: solo un 4xx que no sea 408 ni 409 asegura
 * que el servidor no registró nada. Red, 5xx, 408 y 409 son de resultado incierto.
 */
function isDefinitiveRejection(error: unknown) {
  return (
    error instanceof ClientApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408 &&
    error.status !== 409
  );
}

function formatAmount(value: number, currency: PaymentFormCurrency) {
  return currency === "USD" ? formatRefUsd(value) : formatVesBs(value);
}

function countPayments(count: number) {
  return count === 1 ? "1 pago" : `${count} pagos`;
}

function sumAmounts(rows: readonly RunRow[]) {
  return rows.reduce((cents, row) => cents + Math.round(row.allocation.amount * 100), 0) / 100;
}

function AllocationRow({
  allocation,
  currency,
  label,
  row,
}: {
  allocation: Allocation;
  currency: PaymentFormCurrency;
  label: string;
  row?: RunRow;
}) {
  const badge = row ? STATUS_BADGES[row.status] : undefined;

  return (
    <li
      aria-label={label}
      className="grid gap-2 rounded-md border border-border bg-surface-container-lowest p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground [overflow-wrap:anywhere]">{label}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {formatDate(allocation.document.createdAt)}
          </p>
        </div>
        {badge ? <Badge variant={badge.variant}>{badge.label}</Badge> : null}
      </div>
      <dl className="grid grid-cols-3 gap-2 text-xs">
        <div className="min-w-0">
          <dt className="text-slate-500 dark:text-slate-400">Saldo</dt>
          <dd className="font-medium text-foreground [overflow-wrap:anywhere]">
            {formatVesBs(allocation.document.pendingVes)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-slate-500 dark:text-slate-400">Se abona</dt>
          <dd className="font-semibold text-indigo-700 [overflow-wrap:anywhere] dark:text-indigo-300">
            {formatAmount(allocation.amount, currency)}
          </dd>
          {currency === "USD" ? (
            <dd className="text-slate-500 [overflow-wrap:anywhere] dark:text-slate-400">
              {formatVesBs(allocation.appliedVes)}
            </dd>
          ) : null}
        </div>
        <div className="min-w-0">
          <dt className="text-slate-500 dark:text-slate-400">Queda</dt>
          <dd className="font-medium text-foreground [overflow-wrap:anywhere]">
            {formatVesBs(allocation.remainingVes)}
          </dd>
        </div>
      </dl>
      {row?.error ? (
        <p className="min-w-0 text-sm text-red-700 [overflow-wrap:anywhere] dark:text-red-300">
          {row.error.message}
        </p>
      ) : null}
    </li>
  );
}

export function ContactSettlementModal({
  contactId,
  contactName,
  onOpenChange,
  onSettled,
  open: controlledOpen,
  trigger,
  type,
}: ContactSettlementModalProps) {
  const texts = TEXTS[type];
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? controlledOpen : internalOpen;
  const [renderedOpen, setRenderedOpen] = useState(open);
  const [step, setStep] = useState<Step>("form");
  const [storedValues, setValues] = useState<PaymentFormValues>(() =>
    createEmptyPaymentFormValues(),
  );
  const [showErrors, setShowErrors] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  // Candado contra reentrada: `isRunning` no cambia hasta el siguiente render y dos
  // clics en el mismo tick arrancarían dos secuencias.
  const runLockRef = useRef(false);
  const createPayment = useCreatePayment();
  const openDocuments = useOpenDocuments(
    { contactId, limit: MAX_PAGE_LIMIT, type },
    { enabled: open && Boolean(contactId) },
  );
  // Una compra se convierte con la tasa del día de la tienda, no con la suya.
  const currentRate = useCurrentExchangeRate({ enabled: open && type === "purchase" });
  const enabledPaymentMethodsQuery = useEnabledPaymentMethods();
  const enabledMethods = useMemo(
    () =>
      filterEnabledPaymentMethods(
        enabledPaymentMethodsQuery.data ?? DEFAULT_ENABLED_PAYMENT_METHODS,
      ),
    [enabledPaymentMethodsQuery.data],
  );
  const dayRateVes = currentRate.data?.rateVes;
  const documents = useMemo<SettlementDocument[]>(
    () =>
      (openDocuments.data?.items ?? [])
        .filter((document) => document.type === type)
        .map((document) => ({
          ...document,
          rateVes:
            type === "purchase" && dayRateVes !== undefined && dayRateVes > 0
              ? dayRateVes
              : document.refRateVes,
        })),
    [dayRateVes, openDocuments.data, type],
  );
  // Con una sola tasa hay equivalencia en vivo y conversión al cambiar de moneda.
  const sharedRateVes =
    documents.length > 0 && documents.every((document) => document.rateVes === documents[0].rateVes)
      ? documents[0].rateVes
      : undefined;
  // Si la tienda no tiene habilitado el método elegido, se usa el primero habilitado.
  const values = useMemo<PaymentFormValues>(() => {
    if (enabledMethods.length === 0 || enabledMethods.includes(storedValues.method)) {
      return storedValues;
    }

    const [fallbackMethod] = enabledMethods;

    return {
      ...storedValues,
      amount: amountForMethodChange(
        storedValues.method,
        fallbackMethod,
        storedValues.amount,
        sharedRateVes,
      ),
      method: fallbackMethod,
    };
  }, [enabledMethods, sharedRateVes, storedValues]);
  const currency = getPaymentCurrency(values.method);
  const minPayableVes = MIN_PAYABLE_VES_BY_DOCUMENT[type];
  const allocation = useMemo(
    () =>
      allocatePayment({
        amount: Number(values.amount),
        currency,
        documents,
        minPayableVes,
      }),
    [currency, documents, minPayableVes, values.amount],
  );
  const maxAmount = useMemo(
    () => maxAllocatableAmount({ currency, documents, minPayableVes }),
    [currency, documents, minPayableVes],
  );
  // En una compra en USD el reparto depende de la tasa del día: sin ella no se calcula.
  const rateIsLoading = type === "purchase" && currency === "USD" && currentRate.isPending;
  const hasLeftover = Number(values.amount) > 0 && allocation.leftover > 0;
  const canConfirm =
    isPaymentFormValid(values) &&
    enabledMethods.includes(values.method) &&
    allocation.allocations.length > 0 &&
    allocation.leftover === 0 &&
    !rateIsLoading &&
    !openDocuments.isFetching;
  const totals = openDocuments.data?.totals;
  const isPartialList = totals !== undefined && (totals.truncated || totals.count > documents.length);

  // Cada apertura y cada cierre dejan el modal en el paso 1 y limpio.
  if (renderedOpen !== open) {
    setRenderedOpen(open);
    setStep("form");
    setValues(createEmptyPaymentFormValues(values.method));
    setShowErrors(false);
    setRun(null);
  }

  async function runSequence(startRun: Run) {
    if (runLockRef.current) {
      return;
    }

    runLockRef.current = true;
    setIsRunning(true);

    const rows = startRun.rows.map((row) => ({ ...row }));
    const publish = () => setRun({ ...startRun, rows: rows.map((row) => ({ ...row })) });

    try {
      // Uno tras otro, nunca en paralelo: cada pago mueve caja o baúl y el siguiente
      // solo sale cuando el servidor confirmó el anterior.
      for (const row of rows) {
        if (row.status === "registered") {
          continue;
        }

        row.status = "registering";
        row.error = undefined;
        row.uncertain = undefined;
        publish();

        try {
          row.payment = await createPayment.mutateAsync({
            ...startRun.payload,
            amount: row.allocation.amount,
            clientRequestId: row.clientRequestId,
            ...(type === "purchase"
              ? { purchaseId: row.allocation.document.id }
              : { saleId: row.allocation.document.id }),
          });
          row.status = "registered";
          publish();
        } catch (error) {
          row.status = "failed";
          row.error = error instanceof Error ? error : new Error(String(error));
          row.uncertain = !isDefinitiveRejection(error);
          publish();
          return;
        }
      }
    } finally {
      runLockRef.current = false;
      setIsRunning(false);
    }

    onSettled?.([
      ...startRun.priorPayments,
      ...rows.flatMap((row) => (row.payment ? [row.payment] : [])),
    ]);
  }

  function handlePreview() {
    setShowErrors(true);

    if (canConfirm) {
      setStep("preview");
    }
  }

  function handleConfirm() {
    if (runLockRef.current) {
      return;
    }

    if (!canConfirm) {
      setShowErrors(true);
      setStep("form");
      return;
    }

    const nextRun: Run = {
      currency,
      payload: buildPaymentFormPayload(values),
      priorPayments: [
        ...(run?.priorPayments ?? []),
        ...(run?.rows.flatMap((row) => (row.payment ? [row.payment] : [])) ?? []),
      ],
      rows: allocation.allocations.map((item) => ({
        allocation: item,
        clientRequestId: crypto.randomUUID(),
        status: "pending",
      })),
    };

    setRun(nextRun);
    setStep("run");
    void runSequence(nextRun);
  }

  function handleRetry() {
    if (run) {
      void runSequence(run);
    }
  }

  /** Solo tras un rechazo definitivo: lo no registrado vuelve al formulario como monto. */
  function handleEdit() {
    if (!run) {
      return;
    }

    const unregistered = run.rows.filter((row) => row.status !== "registered");

    setValues({ ...values, amount: String(sumAmounts(unregistered)) });
    setShowErrors(false);
    setStep("form");
  }

  const registeredRows = run?.rows.filter((row) => row.status === "registered") ?? [];
  const failedRow = run?.rows.find((row) => row.status === "failed");
  const unsentRows = run?.rows.filter((row) => row.status === "pending") ?? [];
  const isSettled = run !== null && registeredRows.length === run.rows.length;
  const labelsOf = (rows: readonly RunRow[]) =>
    rows.map((row) => texts.label(row.allocation.document.number)).join(", ");

  function renderBody() {
    if (step === "run" && run) {
      return (
        <div className="grid gap-3">
          <ul aria-label="Pagos del abono" className="grid gap-2">
            {run.rows.map((row) => (
              <AllocationRow
                allocation={row.allocation}
                currency={run.currency}
                key={row.allocation.document.id}
                label={texts.label(row.allocation.document.number)}
                row={row}
              />
            ))}
          </ul>

          {isSettled ? (
            <p
              className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              role="status"
            >
              Abono registrado: {countPayments(run.rows.length)} por{" "}
              {formatAmount(sumAmounts(run.rows), run.currency)}.
            </p>
          ) : null}

          {failedRow ? (
            <div className={errorClassName} role="alert">
              <p>
                {registeredRows.length === 1
                  ? `Se registró 1 de ${countPayments(run.rows.length)}.`
                  : `Se registraron ${registeredRows.length} de ${countPayments(run.rows.length)}.`}
              </p>
              {registeredRows.length > 0 ? <p>Registrado: {labelsOf(registeredRows)}.</p> : null}
              <p>Falló: {labelsOf([failedRow])}.</p>
              {unsentRows.length > 0 ? <p>Sin enviar: {labelsOf(unsentRows)}.</p> : null}
              <p className="mt-1">
                {failedRow.uncertain
                  ? "No se sabe si el pago que falló llegó a registrarse. «Reintentar pendientes» lo envía de nuevo sin duplicarlo."
                  : "El pago que falló no se registró. Puedes reintentar los pendientes o volver a editar el abono."}
              </p>
            </div>
          ) : null}
        </div>
      );
    }

    if (openDocuments.isPending) {
      return (
        <p className={noticeClassName} role="status">
          Cargando documentos pendientes...
        </p>
      );
    }

    if (openDocuments.error && !openDocuments.data) {
      return (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
          role="alert"
        >
          <p className="min-w-0 [overflow-wrap:anywhere]">{openDocuments.error.message}</p>
          <Button
            onClick={() => void openDocuments.refetch()}
            size="sm"
            type="button"
            variant="outline"
          >
            Reintentar
          </Button>
        </div>
      );
    }

    if (documents.length === 0) {
      return <EmptyState description="No hay nada que abonar." title={texts.empty(contactName)} />;
    }

    if (step === "preview") {
      return (
        <div className="grid gap-3">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {formatAmount(allocation.appliedAmount, currency)} en{" "}
            {paymentMethodLabels[values.method]}. Se registrará un pago por documento, en este
            orden:
          </p>
          <ul aria-label="Reparto del abono" className="grid gap-2">
            {allocation.allocations.map((item) => (
              <AllocationRow
                allocation={item}
                currency={currency}
                key={item.document.id}
                label={texts.label(item.document.number)}
              />
            ))}
          </ul>
        </div>
      );
    }

    return (
      <div className="grid gap-4">
        <p className={noticeClassName}>
          Total pendiente: <strong>{formatVesBs(totals?.pendingVes ?? 0)}</strong> ·{" "}
          {texts.documents(totals?.count ?? documents.length)}
        </p>

        {isPartialList ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            El abono se reparte entre los {documents.length} documentos más antiguos.
          </p>
        ) : null}

        {registeredRows.length > 0 ? (
          <p
            className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
            role="status"
          >
            Ya se registró: {labelsOf(registeredRows)}. El monto es lo que quedó sin registrar.
          </p>
        ) : null}

        <PaymentFormFields
          methods={enabledMethods}
          onChange={setValues}
          rateVes={sharedRateVes}
          showErrors={showErrors}
          values={values}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={maxAmount <= 0 || rateIsLoading}
            onClick={() => setValues({ ...values, amount: String(maxAmount) })}
            size="sm"
            type="button"
            variant="outline"
          >
            Completar total pendiente
          </Button>
          {maxAmount > 0 && !rateIsLoading ? (
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Máximo: {formatAmount(maxAmount, currency)}
            </span>
          ) : null}
        </div>

        {rateIsLoading ? (
          <p className={noticeClassName} role="status">
            Cargando la tasa del día...
          </p>
        ) : null}

        {hasLeftover && !rateIsLoading ? (
          <p className={errorClassName} role="alert">
            El monto supera lo que se puede abonar: sobran{" "}
            {formatAmount(allocation.leftover, currency)}. Máximo:{" "}
            {formatAmount(maxAmount, currency)}.
          </p>
        ) : null}
      </div>
    );
  }

  function renderFooter(close: () => void) {
    if (step === "run" && run) {
      return (
        <>
          <Button disabled={isRunning} onClick={close} type="button" variant="outline">
            Cerrar
          </Button>
          {failedRow && !failedRow.uncertain ? (
            <Button disabled={isRunning} onClick={handleEdit} type="button" variant="outline">
              Volver a editar
            </Button>
          ) : null}
          {!isSettled ? (
            <Button disabled={isRunning} onClick={handleRetry} type="button">
              {isRunning ? "Registrando..." : "Reintentar pendientes"}
            </Button>
          ) : null}
        </>
      );
    }

    if (step === "preview" && documents.length > 0) {
      return (
        <>
          <Button onClick={() => setStep("form")} type="button" variant="outline">
            Volver
          </Button>
          <Button onClick={handleConfirm} type="button">
            Confirmar abono
          </Button>
        </>
      );
    }

    return (
      <>
        <Button onClick={close} type="button" variant="outline">
          {documents.length === 0 ? "Cerrar" : "Cancelar"}
        </Button>
        {documents.length > 0 ? (
          <Button
            disabled={rateIsLoading || openDocuments.isFetching}
            onClick={handlePreview}
            type="button"
          >
            Ver reparto
          </Button>
        ) : null}
      </>
    );
  }

  return (
    <Modal
      description={texts.description(contactName)}
      footer={({ close }) => renderFooter(close)}
      onOpenChange={(nextOpen) => {
        // Con pagos en vuelo no se cierra (Esc, X, clic fuera): se perdería qué quedó
        // registrado y qué no.
        if (!nextOpen && (isRunning || runLockRef.current)) {
          return;
        }

        if (!isControlled) {
          setInternalOpen(nextOpen);
        }

        onOpenChange?.(nextOpen);
      }}
      open={open}
      title="Abonar"
      trigger={trigger ?? (isControlled ? undefined : <Button size="sm">Abonar</Button>)}
    >
      {renderBody()}
    </Modal>
  );
}
