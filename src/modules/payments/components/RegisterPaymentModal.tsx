"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { RequestAttempt } from "@/modules/inventory/utils/requestAttempt";
import { purchasesQueryKeys, usePurchase } from "@/modules/purchases/hooks/usePurchases";
import { salesQueryKeys, useSale } from "@/modules/sales/hooks/useSales";
import { useCurrentExchangeRate } from "@/modules/settings/hooks/useCurrentExchangeRate";
import { ClientApiError } from "@/shared/api/apiFetch";
import { Button } from "@/shared/components/Button";
import { Modal } from "@/shared/components/Modal";
import {
  PaymentFormFields,
  type PaymentFormValues,
  amountForMethodChange,
  buildPaymentFormPayload,
  createEmptyPaymentFormValues,
  getPaymentCurrency,
  isPaymentFormValid,
} from "@/shared/payments/PaymentFormFields";
import { formatVes, roundMoney } from "@/shared/utils/currency";

import { type PaymentDetail, paymentsQueryKeys, useCreatePayment } from "../hooks/usePayments";
import { useEnabledPaymentMethods } from "@/modules/settings/hooks/useSettings";
import {
  DEFAULT_ENABLED_PAYMENT_METHODS,
  filterEnabledPaymentMethods,
} from "@/shared/payments/paymentMethods";

/**
 * Modal para pagar una compra o cobrar una venta sin salir de la pantalla.
 *
 * El documento lo fija quien lo usa con `purchaseId` o `saleId` (exactamente uno):
 * el modal carga su saldo pendiente, ofrece "Completar saldo" y registra el pago con
 * una clave de idempotencia por intento. El usuario nunca elige ni teclea el
 * documento aquí (para elegirlo está `PaymentDocumentPicker`). Sin documento, o con
 * los dos, el modal no envía nada.
 *
 * Cambio de documento: el formulario y la clave de idempotencia pertenecen al
 * documento. Si `purchaseId`/`saleId` cambian, el modal se vuelve a montar por dentro
 * (formulario limpio y clave nueva), así que el consumidor no necesita pasar `key`.
 * Con `trigger` (apertura no controlada) ese cambio además lo cierra.
 *
 * Cada apertura vuelve a pedir el saldo del documento y estrena clave de
 * idempotencia. Mientras el modal siga abierto, reintentar sin cambios tras un error
 * de resultado incierto (red, 5xx, 408, 409) conserva la clave y no duplica el pago;
 * tras ese error el modal vuelve a pedir el documento y los pagos, para que se vea
 * si el pago entró.
 *
 * @example Botón dentro del detalle de una venta
 * <RegisterPaymentModal saleId={sale.id} trigger={<Button>Cobrar saldo</Button>} />
 *
 * @example "Pagar ahora" tras crear la compra (apertura por código, sin `trigger`)
 * const [payingPurchaseId, setPayingPurchaseId] = useState<string>();
 *
 * <RegisterPaymentModal
 *   onOpenChange={(open) => {
 *     if (!open) setPayingPurchaseId(undefined);
 *   }}
 *   onRegistered={(payment) => router.push(`/purchases/${payment.purchaseId}`)}
 *   open={payingPurchaseId !== undefined}
 *   purchaseId={payingPurchaseId}
 * />
 */
export type RegisterPaymentModalProps = {
  /**
   * Se llama al abrirse y al cerrarse el modal por una acción del usuario. Con el
   * pago en vuelo el cierre se ignora y no se llama. Necesaria si se pasa `open`.
   */
  onOpenChange?: (open: boolean) => void;
  /**
   * Se llama una vez por pago registrado con éxito, con el pago que devolvió el
   * servidor (`pendingBalanceVes` trae el saldo que queda). El modal no se cierra
   * solo: muestra el saldo restante y permite otro abono; quien quiera cerrarlo lo
   * hace aquí.
   */
  onRegistered?: (payment: PaymentDetail) => void;
  /**
   * Apertura controlada: con un booleano el modal se abre y se cierra por código y no
   * pinta botón propio. Sin esta prop se abre con `trigger`.
   */
  open?: boolean;
  /**
   * Compra a pagar (salida de dinero). No combinar con `saleId`. Puede ir `undefined`
   * mientras el modal está cerrado (apertura por código); abierto sin documento no
   * registra nada.
   */
  purchaseId?: string;
  /**
   * Venta a cobrar (entrada de dinero). No combinar con `purchaseId`. Puede ir
   * `undefined` mientras el modal está cerrado; abierto sin documento no registra nada.
   */
  saleId?: string;
  /** Texto del botón de envío. Por defecto "Registrar pago" (compra) o "Registrar cobro" (venta). */
  submitLabel?: string;
  /** Título del modal. Por defecto "Pagar compra" o "Cobrar saldo" (venta). */
  title?: string;
  /**
   * Elemento que abre el modal al hacer clic. Sin `trigger` ni `open` se pinta un
   * botón con el título.
   */
  trigger?: ReactNode;
};

type DocumentType = "purchase" | "sale";

const DOCUMENT_TEXTS = {
  purchase: { submitLabel: "Registrar pago", title: "Pagar compra" },
  sale: { submitLabel: "Registrar cobro", title: "Cobrar saldo" },
} as const;

const CONNECTION_ERROR_MESSAGE = "No se pudo conectar con el servidor.";

/**
 * Texto de un error para el usuario. Los de negocio (`ClientApiError`) traen el mensaje
 * del servidor y se muestran tal cual; el resto son fallos de red o peticiones
 * abortadas, cuyo mensaje es el del navegador ("Failed to fetch").
 */
function errorMessageFor(error: Error, connectionMessage: string) {
  return error instanceof ClientApiError ? error.message : connectionMessage;
}

/**
 * El servidor pudo haber registrado el pago aunque la respuesta sea un error: fallo de
 * red, 5xx, 408 y 409 (los mismos casos en los que `RequestAttempt` conserva la clave).
 */
function isUncertainResult(error: unknown) {
  return (
    !(error instanceof ClientApiError) ||
    error.status >= 500 ||
    error.status === 408 ||
    error.status === 409
  );
}

/**
 * Bs por encima del saldo que `register_payment` todavía acepta (guardas F2/F3 de
 * `20260904-payment-guards.sql`); más allá responde 400, así que no se envía.
 * - Venta: el "redondeo a favor", Bs 10 (o 1 % de la tasa) y 1 USD en efectivo USD.
 * - Compra en Bs: el céntimo de la conversión.
 * - Compra en USD: el servidor convierte con la tasa del día y tolera el mismo
 *   céntimo. Sin la tasa del día (`hasDayRate` falso) → `undefined`: superar el saldo
 *   solo se avisa y decide el servidor.
 */
function serverOverpayToleranceVes(
  document: "purchase" | "sale" | undefined,
  currency: "USD" | "VES",
  rateVes: number | undefined,
  hasDayRate: boolean,
): number | undefined {
  if (document === "purchase") {
    return currency === "VES" || hasDayRate ? 0.01 : undefined;
  }

  if (document !== "sale" || !rateVes || rateVes <= 0) {
    return undefined;
  }

  const roundingVes = Math.max(10, roundMoney(0.01 * rateVes));

  return currency === "USD" ? Math.max(roundingVes, roundMoney(rateVes)) : roundingVes;
}

/**
 * El estado del formulario y el `RequestAttempt` viven en `RegisterPaymentForm`, que
 * se monta de nuevo con cada documento: la clave de un intento de resultado incierto
 * (red, 5xx) nunca viaja con otra venta u otra compra. Dentro de un mismo documento,
 * cada apertura estrena `RequestAttempt`.
 */
export function RegisterPaymentModal(props: RegisterPaymentModalProps) {
  return (
    <RegisterPaymentForm
      key={`sale:${props.saleId ?? ""}|purchase:${props.purchaseId ?? ""}`}
      {...props}
    />
  );
}

function RegisterPaymentForm({
  onOpenChange,
  onRegistered,
  open: controlledOpen,
  purchaseId,
  saleId,
  submitLabel,
  title,
  trigger,
}: RegisterPaymentModalProps) {
  const formId = useId();
  // Exactamente un documento: sin ninguno, o con los dos, no se envía nada.
  const fixedDocument: DocumentType | undefined =
    purchaseId && !saleId ? "purchase" : saleId && !purchaseId ? "sale" : undefined;
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? controlledOpen : internalOpen;
  const [renderedOpen, setRenderedOpen] = useState(open);
  const [storedValues, setValues] = useState<PaymentFormValues>(() =>
    createEmptyPaymentFormValues(),
  );
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [successBalanceVes, setSuccessBalanceVes] = useState<number | undefined>();
  const [submitError, setSubmitError] = useState<Error | null>(null);
  const queryClient = useQueryClient();
  const createPayment = useCreatePayment();
  // Candado contra reentrada: `isPending` no cambia hasta el siguiente render, y dos
  // envíos en el mismo tick saldrían como dos peticiones. La clave de idempotencia
  // haría que el servidor registre una sola, pero la segunda no debe ni salir.
  const submitLockRef = useRef(false);
  // Clave de idempotencia (PAG-06): la misma en el reintento tras un resultado
  // incierto (red, 5xx, 409); nueva tras el éxito o tras un 4xx con otro contenido.
  // Un intento por apertura: la clave de un envío incierto no sobrevive al cierre.
  const [requestAttempt, setRequestAttempt] = useState(() => new RequestAttempt());
  const enabledPaymentMethodsQuery = useEnabledPaymentMethods();
  const enabledMethods = useMemo(
    () =>
      filterEnabledPaymentMethods(
        enabledPaymentMethodsQuery.data ?? DEFAULT_ENABLED_PAYMENT_METHODS,
      ),
    [enabledPaymentMethodsQuery.data],
  );
  const sale = useSale(saleId);
  const purchase = usePurchase(purchaseId);
  // `register_payment` convierte una compra con la tasa del día de la tienda (la venta
  // usa la suya); si la tienda no tiene, cae en la de la compra.
  const currentRate = useCurrentExchangeRate({ enabled: open && fixedDocument === "purchase" });
  const dayRateVes =
    fixedDocument === "purchase" && currentRate.data && currentRate.data.rateVes > 0
      ? currentRate.data.rateVes
      : undefined;
  const pendingBalanceVes = useMemo(() => {
    if (sale.data) {
      return Math.max(sale.data.totalVes - sale.data.paidVes, 0);
    }

    if (purchase.data) {
      return Math.max(purchase.data.totalVes - purchase.data.paidVes, 0);
    }

    return undefined;
  }, [purchase.data, sale.data]);
  const rateVes = sale.data?.refRateVes ?? dayRateVes ?? purchase.data?.refRateVes;
  // Si la tienda no tiene habilitado el método elegido, se usa el primero habilitado.
  // Los métodos pueden llegar con un monto ya tecleado: se convierte igual que en el
  // cambio manual de método, para que la cifra no se lea en otra moneda.
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
        rateVes,
      ),
      method: fallbackMethod,
    };
  }, [enabledMethods, rateVes, storedValues]);
  const { method } = values;
  const overpayToleranceVes = serverOverpayToleranceVes(
    sale.data ? "sale" : purchase.data ? "purchase" : undefined,
    getPaymentCurrency(method),
    rateVes,
    dayRateVes !== undefined,
  );
  const hasDocument = fixedDocument !== undefined;
  // Sin el saldo no hay guarda de sobrepago: mientras el documento carga o se vuelve a
  // pedir (cada apertura, tras cada pago y tras un envío de resultado incierto) no se
  // envía; si la carga falló se avisa y decide el servidor (`register_payment`).
  const linkedDocument =
    fixedDocument === "sale" ? sale : fixedDocument === "purchase" ? purchase : undefined;
  const refetchDocument = linkedDocument?.refetch;
  const balanceIsLoading = Boolean(linkedDocument?.isFetching);
  const balanceError = linkedDocument?.error ?? null;
  // Igual con la tasa del día de una compra en USD: mientras carga no se envía; si no
  // se pudo obtener, superar el saldo solo se avisa.
  const dayRateIsLoading =
    fixedDocument === "purchase" && getPaymentCurrency(method) === "USD" && currentRate.isPending;
  // Un documento ya saldado no admite otro pago, por pequeño que sea.
  const isSettled = pendingBalanceVes !== undefined && roundMoney(pendingBalanceVes) <= 0;
  const canSubmit =
    hasDocument &&
    !balanceIsLoading &&
    !dayRateIsLoading &&
    !isSettled &&
    isPaymentFormValid(values, {
      overpayToleranceVes,
      pendingBalance: pendingBalanceVes,
      rateVes,
    }) &&
    enabledMethods.includes(method);

  function clearFields() {
    setValues(createEmptyPaymentFormValues(method));
    setHasSubmitted(false);
  }

  // Cada apertura y cada cierre dejan el formulario limpio y estrenan intento, también
  // cuando quien abre o cierra es el padre con `open`.
  if (renderedOpen !== open) {
    setRenderedOpen(open);
    clearFields();
    setSuccessBalanceVes(undefined);
    setSubmitError(null);
    setRequestAttempt(new RequestAttempt());
  }

  // Cada apertura muestra el saldo recién pedido, no el que quedó en caché.
  useEffect(() => {
    if (open) {
      void refetchDocument?.({ cancelRefetch: false });
    }
  }, [open, refetchDocument]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHasSubmitted(true);
    setSuccessBalanceVes(undefined);

    if (!canSubmit || submitLockRef.current || createPayment.isPending) {
      return;
    }

    // La huella del intento es el pago completo: documento y valores del formulario.
    const input = {
      ...buildPaymentFormPayload(values),
      purchaseId,
      saleId,
    };
    const clientRequestId = requestAttempt.begin(input);

    if (!clientRequestId) {
      return;
    }

    submitLockRef.current = true;
    setSubmitError(null);

    let payment: PaymentDetail;

    try {
      payment = await createPayment.mutateAsync({ ...input, clientRequestId });
      requestAttempt.succeed();
    } catch (error) {
      requestAttempt.fail(error);
      setSubmitError(error instanceof Error ? error : new Error(String(error)));

      // El pago pudo haberse registrado: se vuelven a pedir el documento (saldo) y los
      // pagos para que el usuario lo vea antes de reintentar.
      if (isUncertainResult(error)) {
        void queryClient.invalidateQueries({
          queryKey: fixedDocument === "sale" ? salesQueryKeys.all : purchasesQueryKeys.all,
        });
        void queryClient.invalidateQueries({ queryKey: paymentsQueryKeys.all });
      }

      return;
    } finally {
      submitLockRef.current = false;
    }

    setSuccessBalanceVes(payment.pendingBalanceVes);
    clearFields();
    onRegistered?.(payment);
  }

  /** Nombra el documento por su número y su contacto; nunca por el id interno. */
  function describeDocument() {
    if (fixedDocument === "purchase") {
      const number = purchase.data?.purchaseNumber;
      const supplier = purchase.data?.supplier?.name;

      if (!number) {
        return "Registra un pago de esta compra.";
      }

      return supplier ? `Compra ${number} a ${supplier}.` : `Compra ${number}.`;
    }

    if (fixedDocument === "sale") {
      const number = sale.data?.invoiceNumber;
      const customer = sale.data?.customer?.name;

      if (!number) {
        return "Registra un cobro de esta venta.";
      }

      return customer ? `Venta ${number} de ${customer}.` : `Venta ${number}.`;
    }

    return "No hay un documento seleccionado.";
  }

  const documentTexts = fixedDocument ? DOCUMENT_TEXTS[fixedDocument] : undefined;
  const resolvedTitle = title ?? documentTexts?.title ?? "Registrar pago";
  const resolvedSubmitLabel = submitLabel ?? documentTexts?.submitLabel ?? "Registrar pago";

  return (
    <Modal
      description={describeDocument()}
      footer={({ close }) => (
        <>
          <Button
            disabled={createPayment.isPending}
            onClick={close}
            type="button"
            variant="outline"
          >
            Cancelar
          </Button>
          <Button
            disabled={createPayment.isPending || balanceIsLoading || dayRateIsLoading}
            form={formId}
            type="submit"
          >
            {createPayment.isPending ? "Registrando..." : resolvedSubmitLabel}
          </Button>
        </>
      )}
      onOpenChange={(nextOpen) => {
        // Con el pago en vuelo no se cierra (Esc, X, clic fuera): al reabrir, el
        // formulario limpio invitaría a registrarlo otra vez.
        if (!nextOpen && (createPayment.isPending || submitLockRef.current)) {
          return;
        }

        if (!isControlled) {
          setInternalOpen(nextOpen);
        }

        onOpenChange?.(nextOpen);
      }}
      open={open}
      title={resolvedTitle}
      trigger={trigger ?? (isControlled ? undefined : <Button size="sm">{resolvedTitle}</Button>)}
    >
      <form className="grid gap-4" id={formId} onSubmit={handleSubmit}>
        {pendingBalanceVes !== undefined && !balanceIsLoading ? (
          <p className="rounded-md bg-indigo-50 px-3 py-2 text-sm text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
            Saldo pendiente actual: {formatVes(pendingBalanceVes)}
          </p>
        ) : null}

        {balanceIsLoading ? (
          <p
            className="rounded-md bg-indigo-50 px-3 py-2 text-sm text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
            role="status"
          >
            Cargando saldo pendiente...
          </p>
        ) : null}

        {dayRateIsLoading && !balanceIsLoading ? (
          <p
            className="rounded-md bg-indigo-50 px-3 py-2 text-sm text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
            role="status"
          >
            Cargando la tasa del día...
          </p>
        ) : null}

        {balanceError ? (
          <div
            className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200"
            role="alert"
          >
            <p className="min-w-0 [overflow-wrap:anywhere]">No se pudo comprobar el saldo pendiente: {errorMessageFor(balanceError, CONNECTION_ERROR_MESSAGE)}</p>
            <Button
              onClick={() => void linkedDocument?.refetch()}
              size="sm"
              type="button"
              variant="outline"
            >
              Reintentar
            </Button>
          </div>
        ) : null}

        {hasSubmitted && !hasDocument ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            El pago debe estar asociado solo a una venta o solo a una compra.
          </p>
        ) : null}

        <PaymentFormFields
          methods={enabledMethods}
          onChange={setValues}
          overpayToleranceVes={overpayToleranceVes}
          pendingBalance={pendingBalanceVes}
          rateVes={rateVes}
          showErrors={hasSubmitted}
          values={values}
        />

        {successBalanceVes !== undefined ? (
          <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">
            Pago registrado. Saldo pendiente: {formatVes(successBalanceVes)}
          </p>
        ) : null}

        {submitError ? (
          <p className="min-w-0 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 [overflow-wrap:anywhere] dark:bg-red-950 dark:text-red-300">
            {errorMessageFor(
              submitError,
              `${CONNECTION_ERROR_MESSAGE} Revisa la conexión y reintenta: el pago no se duplicará.`,
            )}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
