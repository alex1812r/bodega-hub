"use client";

import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { MAX_PAGE_LIMIT } from "@/lib/api/pagination";
import { useCurrentExchangeRate } from "@/modules/settings/hooks/useCurrentExchangeRate";
import { useEnabledPaymentMethods } from "@/modules/settings/hooks/useSettings";
import { ClientApiError } from "@/shared/api/apiFetch";
import { Badge } from "@/shared/components/Badge";
import { Button } from "@/shared/components/Button";
import { EmptyState } from "@/shared/components/EmptyState";
import { Modal } from "@/shared/components/Modal";
import { ProcessGuard } from "@/shared/components/ProcessGuard";
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
import { type PaymentDetail, paymentsQueryKeys, useCreatePayment } from "../hooks/usePayments";
import { formatPurchaseNumberDisplay } from "../payments-list/utils/paymentReference";
import {
  MIN_PAYABLE_VES_BY_DOCUMENT,
  type PaymentAllocation,
  allocatePayment,
  maxAllocatableAmount,
} from "../utils/allocatePayment";
import {
  type PendingSettlement,
  type PendingSettlementDocument,
  clearPendingSettlement,
  loadPendingSettlement,
  savePendingSettlement,
} from "../utils/pendingSettlementStore";

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
 * **Abono por confirmar.** Si un pago falla sin que se sepa si se registró (red, 5xx,
 * 408, 409), el abono queda "por confirmar": el modal no deja editar ni empezar otro
 * abono; solo "Reintentar pendientes", que reenvía cada pago con su misma clave de
 * idempotencia hasta que quede registrado o el servidor lo rechace (4xx). Ese abono
 * sobrevive a cerrar el modal y, guardado en `sessionStorage` por contacto y tipo
 * (`pendingSettlementStore`), a recargar o navegar: al abrir "Abonar" de nuevo se
 * muestra directamente. Quien monte el modal de forma condicional debe mantenerlo
 * montado mientras `useHasPendingSettlement({ contactId, type })` sea `true`.
 *
 * Tras un rechazo definitivo (4xx) se puede reintentar, continuar con los documentos
 * que no se enviaron o volver a editar: el reparto se recalcula con los saldos recién
 * pedidos. Al abrir, y tras cada fallo, la lista de documentos se vuelve a pedir y el
 * reparto no se puede ver ni confirmar hasta que llega.
 *
 * Si el modal se desmonta a mitad de la secuencia, el pago en vuelo termina y los
 * siguientes NO se envían: quedan guardados para continuar. Mientras hay pagos en
 * vuelo o un abono por confirmar, un guardia (`ProcessGuard`, "Abono en curso")
 * pregunta antes de salir de la pantalla.
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

/** Reparto de un pago ya enviado: solo lo que se pinta, se reenvía y se guarda. */
type RunAllocation = PaymentAllocation<PendingSettlementDocument>;

type RowStatus = "failed" | "pending" | "registered" | "registering";

type RunRow = {
  allocation: RunAllocation;
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
  /** Lo tecleado al confirmar: "Volver a editar" parte de aquí. */
  values: PaymentFormValues;
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

const CONNECTION_ERROR_MESSAGE = "No se pudo conectar con el servidor.";
const UNCERTAIN_MESSAGE =
  "No pudimos confirmar si este pago se registró. Reintenta: si ya entró, no se duplicará.";

/** Primer motivo de un 400 de validación (`issues` de Zod), si el error lo trae. */
function firstIssueMessage(issues: unknown) {
  const [first]: unknown[] = Array.isArray(issues) ? issues : [];

  if (typeof first === "object" && first !== null && "message" in first) {
    return typeof first.message === "string" && first.message.trim() ? first.message : undefined;
  }

  return undefined;
}

/**
 * Error que se pinta en la fila. Los de negocio llevan el mensaje del servidor tal
 * cual (más el primer motivo de validación); el resto son fallos de red, cuyo texto
 * es el del navegador ("Failed to fetch").
 */
function toRowError(error: unknown) {
  if (!(error instanceof ClientApiError)) {
    return new Error(CONNECTION_ERROR_MESSAGE);
  }

  const reason = firstIssueMessage(error.issues);

  return reason ? new Error(`${error.message} ${reason}`) : error;
}

function isUncertainRow(row: RunRow) {
  return row.status === "failed" && row.uncertain === true;
}

/**
 * Lo que se guarda de un abono sin terminar. Un pago en vuelo se guarda como de
 * resultado incierto: si la página se recarga antes de la respuesta, no se sabe.
 */
function toPendingSettlement(run: Run): PendingSettlement {
  return {
    currency: run.currency,
    payload: run.payload,
    rows: run.rows.map((row) => {
      const { document } = row.allocation;
      const inFlight = row.status === "registering";

      return {
        allocation: {
          amount: row.allocation.amount,
          appliedVes: row.allocation.appliedVes,
          document: {
            createdAt: document.createdAt,
            id: document.id,
            number: document.number,
            pendingVes: document.pendingVes,
          },
          equivalent: row.allocation.equivalent,
          remainingVes: row.allocation.remainingVes,
        },
        clientRequestId: row.clientRequestId,
        errorMessage: row.error?.message,
        status: row.status === "registering" ? "failed" : row.status,
        uncertain: inFlight ? true : row.uncertain,
      };
    }),
    values: run.values,
  };
}

function fromPendingSettlement(settlement: PendingSettlement | null): Run | null {
  if (!settlement) {
    return null;
  }

  return {
    currency: settlement.currency,
    payload: settlement.payload,
    priorPayments: [],
    rows: settlement.rows.map((row) => ({
      allocation: row.allocation,
      clientRequestId: row.clientRequestId,
      error: row.errorMessage ? new Error(row.errorMessage) : undefined,
      status: row.status,
      uncertain: row.uncertain,
    })),
    values: settlement.values,
  };
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
  allocation: RunAllocation;
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
  // Un abono que quedó sin terminar (recarga, navegación) se retoma donde estaba.
  const [restoredRun] = useState(() =>
    fromPendingSettlement(loadPendingSettlement({ contactId, type })),
  );
  const [step, setStep] = useState<Step>(restoredRun ? "run" : "form");
  const [storedValues, setValues] = useState<PaymentFormValues>(() =>
    createEmptyPaymentFormValues(),
  );
  const [showErrors, setShowErrors] = useState(false);
  const [run, setRun] = useState<Run | null>(restoredRun);
  const [isRunning, setIsRunning] = useState(false);
  // Candado contra reentrada: `isRunning` no cambia hasta el siguiente render y dos
  // clics en el mismo tick arrancarían dos secuencias.
  const runLockRef = useRef(false);
  const mountedRef = useRef(true);
  const queryClient = useQueryClient();
  const createPayment = useCreatePayment();
  const openDocuments = useOpenDocuments(
    { contactId, limit: MAX_PAGE_LIMIT, type },
    { enabled: open && Boolean(contactId) },
  );
  // La lista vale para repartir solo si se leyó después de este momento: al abrir y al
  // volver a editar se anota la última lectura y se espera a una más nueva.
  const [staleDocumentsAt, setStaleDocumentsAt] = useState(openDocuments.dataUpdatedAt);
  const documentsAreFresh =
    openDocuments.data !== undefined && openDocuments.dataUpdatedAt !== staleDocumentsAt;
  const refetchDocuments = openDocuments.refetch;
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
    documentsAreFresh &&
    !openDocuments.isFetching;
  const totals = openDocuments.data?.totals;
  const isPartialList = totals !== undefined && (totals.truncated || totals.count > documents.length);

  const registeredRows = run?.rows.filter((row) => row.status === "registered") ?? [];
  const failedRows = run?.rows.filter((row) => row.status === "failed") ?? [];
  const unsentRows = run?.rows.filter((row) => row.status === "pending") ?? [];
  const isSettled = run !== null && registeredRows.length === run.rows.length;
  const hasUncertainRow = failedRows.some(isUncertainRow);
  // Por confirmar: algún pago pudo haberse registrado. Solo cabe reenviarlo igual.
  const needsConfirmation = !isSettled && hasUncertainRow;
  // La secuencia se cortó (el modal se desmontó) antes de enviar todos los pagos.
  const isInterrupted =
    !isRunning && !isSettled && failedRows.length === 0 && unsentRows.length > 0;

  // Cada cierre deja el modal en el paso 1 y limpio, salvo con un abono por confirmar:
  // ese se conserva y la siguiente apertura lo muestra directamente.
  if (renderedOpen !== open) {
    setRenderedOpen(open);

    if (open) {
      setStaleDocumentsAt(openDocuments.dataUpdatedAt);

      if (run !== null && !isSettled) {
        setStep("run");
      }
    } else if (!needsConfirmation) {
      setStep("form");
      setValues(createEmptyPaymentFormValues(values.method));
      setShowErrors(false);
      setRun(null);
    }
  }

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Abierto con una lista anterior a la apertura (o a "Volver a editar"): se pide otra.
  // `cancelRefetch: false` reutiliza la petición que ya esté en curso.
  useEffect(() => {
    if (open && contactId && !documentsAreFresh) {
      void refetchDocuments({ cancelRefetch: false });
    }
  }, [contactId, documentsAreFresh, open, refetchDocuments]);

  // Un abono descartado (cerrar o editar sin nada por confirmar) deja de estar guardado.
  useEffect(() => {
    if (run === null && !runLockRef.current) {
      clearPendingSettlement({ contactId, type });
    }
  }, [contactId, run, type]);

  /** El saldo pudo cambiar: documentos con saldo y pagos, el contacto y sus documentos. */
  function invalidateBalances() {
    void queryClient.invalidateQueries({ queryKey: paymentsQueryKeys.all });
    void queryClient.invalidateQueries({ queryKey: ["contacts"] });
    void queryClient.invalidateQueries({ queryKey: [type === "purchase" ? "purchases" : "sales"] });
  }

  /**
   * `skipRejected`: los pagos que el servidor rechazó (4xx) se dejan como están y la
   * secuencia sigue con los que no se llegaron a enviar.
   */
  async function runSequence(startRun: Run, { skipRejected = false } = {}) {
    if (runLockRef.current) {
      return;
    }

    runLockRef.current = true;
    setIsRunning(true);

    const scope = { contactId, type };
    const rows = startRun.rows.map((row) => ({ ...row }));
    // Cada cambio se guarda además de pintarse: las claves sobreviven a una recarga y a
    // que el modal se desmonte con la secuencia en marcha.
    const publish = () => {
      const nextRun = { ...startRun, rows: rows.map((row) => ({ ...row })) };

      savePendingSettlement(scope, toPendingSettlement(nextRun));
      setRun(nextRun);
    };

    try {
      // Uno tras otro, nunca en paralelo: cada pago mueve caja o baúl y el siguiente
      // solo sale cuando el servidor confirmó el anterior.
      for (const row of rows) {
        if (row.status === "registered") {
          continue;
        }

        if (skipRejected && row.status === "failed" && !row.uncertain) {
          continue;
        }

        // Sin pantalla no se envía nada más: lo pendiente ya quedó guardado.
        if (!mountedRef.current) {
          break;
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
          row.error = toRowError(error);
          row.uncertain = !isDefinitiveRejection(error);
          publish();
          // Incierto o rechazado, el saldo real puede no ser el que hay en pantalla.
          invalidateBalances();
          break;
        }
      }
    } finally {
      runLockRef.current = false;
      setIsRunning(false);
    }

    if (rows.some((row) => row.status !== "registered")) {
      return;
    }

    clearPendingSettlement(scope);

    if (mountedRef.current) {
      onSettled?.([
        ...startRun.priorPayments,
        ...rows.flatMap((row) => (row.payment ? [row.payment] : [])),
      ]);
    }
  }

  function handlePreview() {
    setShowErrors(true);

    if (canConfirm) {
      setStep("preview");
    }
  }

  function handleConfirm() {
    // Con un abono por confirmar no se arranca otro: sus pagos saldrían con claves nuevas.
    if (runLockRef.current || needsConfirmation) {
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
      values,
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

  /** Tras un rechazo definitivo: deja el rechazado como está y envía los no enviados. */
  function handleContinue() {
    if (run && !hasUncertainRow) {
      void runSequence(run, { skipRejected: true });
    }
  }

  /**
   * Sin nada por confirmar: lo no registrado vuelve al formulario como monto y el
   * reparto se recalcula con los saldos que se piden en ese momento.
   */
  function handleEdit() {
    if (!run || hasUncertainRow) {
      return;
    }

    const unregistered = run.rows.filter((row) => row.status !== "registered");

    setValues({ ...run.values, amount: String(sumAmounts(unregistered)) });
    setShowErrors(false);
    setStaleDocumentsAt(openDocuments.dataUpdatedAt);
    setStep("form");
  }

  const canEdit = !hasUncertainRow && (failedRows.length > 0 || isInterrupted);
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

          {failedRows.length > 0 || isInterrupted ? (
            <div className={errorClassName} role="alert">
              <p>
                {registeredRows.length === 1
                  ? `Se registró 1 de ${countPayments(run.rows.length)}.`
                  : `Se registraron ${registeredRows.length} de ${countPayments(run.rows.length)}.`}
              </p>
              {registeredRows.length > 0 ? <p>Registrado: {labelsOf(registeredRows)}.</p> : null}
              {failedRows.length > 0 ? <p>Falló: {labelsOf(failedRows)}.</p> : null}
              {unsentRows.length > 0 ? <p>Sin enviar: {labelsOf(unsentRows)}.</p> : null}
              <p className="mt-1">
                {hasUncertainRow
                  ? UNCERTAIN_MESSAGE
                  : failedRows.length > 0
                    ? "El pago que falló no se registró. Puedes reintentar los pendientes o volver a editar el abono."
                    : "El abono se interrumpió antes de enviar todos los pagos. Puedes enviar los pendientes o volver a editar el abono."}
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

    // Sin lista, o con una que ya no vale porque no se pudo volver a pedir.
    if (
      openDocuments.error &&
      !documentsAreFresh &&
      (!openDocuments.isFetching || !openDocuments.data)
    ) {
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

        {documentsAreFresh ? null : (
          <p className={noticeClassName} role="status">
            Actualizando saldos...
          </p>
        )}

        {hasLeftover && !rateIsLoading ? (
          <p className={errorClassName} role="alert">
            {Number(values.amount) > maxAmount
              ? `El monto supera lo que se puede abonar: sobran ${formatAmount(allocation.leftover, currency)}. Máximo abonable: ${formatAmount(maxAmount, currency)}.`
              : `No se puede abonar exactamente ${formatAmount(Number(values.amount), currency)}: dejaría un saldo demasiado pequeño para cobrarlo después. Abona ${formatAmount(allocation.appliedAmount, currency)} o el máximo abonable, ${formatAmount(maxAmount, currency)}.`}
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
          {canEdit ? (
            <Button disabled={isRunning} onClick={handleEdit} type="button" variant="outline">
              Volver a editar
            </Button>
          ) : null}
          {canEdit && failedRows.length > 0 && unsentRows.length > 0 ? (
            <Button disabled={isRunning} onClick={handleContinue} type="button" variant="outline">
              Continuar con los demás
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
            disabled={rateIsLoading || openDocuments.isFetching || !documentsAreFresh}
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
    <>
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
      {/* Solo existe con pagos en vuelo o un abono por confirmar: nunca con el
          formulario limpio ni tras terminar con éxito. */}
      {isRunning || needsConfirmation ? (
        <ProcessGuard
          active
          description={
            isRunning
              ? "Hay pagos de este abono enviándose. Si sales, los que falten no se envían y quedan guardados para continuar desde «Abonar»."
              : "No pudimos confirmar si un pago se registró. Abre «Abonar» y pulsa «Reintentar pendientes»: si ya entró, no se duplicará."
          }
          label="Abono en curso"
          onLeave="draft"
        />
      ) : null}
    </>
  );
}
