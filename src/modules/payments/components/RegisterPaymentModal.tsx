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

import { purchasesQueryKeys, usePurchase } from "@/modules/purchases/hooks/usePurchases";
import { salesQueryKeys, useSale } from "@/modules/sales/hooks/useSales";
import { useCurrentExchangeRate } from "@/modules/settings/hooks/useCurrentExchangeRate";
import { ClientApiError } from "@/shared/api/apiFetch";
import { Button } from "@/shared/components/Button";
import { ConfirmActionModal } from "@/shared/components/ConfirmActionModal";
import { Modal } from "@/shared/components/Modal";
import { ProcessGuard } from "@/shared/components/ProcessGuard";
import {
  PaymentFormFields,
  type PaymentFormValues,
  amountForMethodChange,
  buildPaymentFormPayload,
  createEmptyPaymentFormValues,
  getPaymentCurrency,
  isPaymentFormValid,
} from "@/shared/payments/PaymentFormFields";
import { formatRefUsd, formatVes, roundMoney } from "@/shared/utils/currency";

import {
  type PaymentCreateInput,
  type PaymentDetail,
  paymentsQueryKeys,
  useCreatePayment,
} from "../hooks/usePayments";
import { useStepClickGuard } from "../hooks/useStepClickGuard";
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
 * (formulario limpio y clave nueva, salvo que ese documento tenga un intento por
 * confirmar), así que el consumidor no necesita pasar `key`.
 * Con `trigger` (apertura no controlada) ese cambio además lo cierra.
 *
 * Cada apertura vuelve a pedir el saldo del documento y, si no hay un intento por
 * confirmar, estrena formulario y clave de idempotencia.
 *
 * Intento por confirmar: tras un error de resultado incierto (red, tiempo límite de
 * 30 s, 5xx, 408, 409) el pago pudo quedar registrado. El modal vuelve a pedir el
 * documento y los pagos, bloquea los campos con lo enviado y solo ofrece
 * "Reintentar", que reenvía exactamente lo mismo con la misma clave (el servidor
 * devuelve el pago original o lo registra una vez). Ese estado es del documento y
 * vive en esta instancia del modal: sobrevive a cerrarlo y reabrirlo y a que el
 * consumidor le cambie el documento y vuelva, pero no a desmontar el modal (mantenlo
 * montado mientras la pantalla siga viva). Se resuelve cuando el reintento registra el
 * pago (flujo normal, con `onRegistered`) o cuando el servidor lo rechaza con un 4xx
 * (409 incluido): se muestra su mensaje, se refresca el saldo y se vuelve a editar con
 * clave nueva. Si un reintento vuelve a quedar sin confirmar aparece además "Descartar
 * intento": pide confirmación (`ConfirmActionModal`), suelta el intento, refresca el
 * saldo y deja el formulario limpio con clave nueva. No se ofrece antes del primer
 * reintento fallido.
 *
 * Doble clic: tras terminar un envío, y al aparecer o resolverse el intento por
 * confirmar, la acción principal y "Descartar intento" quedan deshabilitadas ~400 ms y
 * se ignoran los cierres por clic fuera; recién abierta la confirmación de descarte,
 * su botón de confirmar y su cierre por clic fuera esperan lo mismo
 * (`useStepClickGuard`). Así el segundo clic de un doble clic no ejecuta el botón que
 * ocupa el sitio del anterior ni cierra el modal. "Cancelar", Esc y la X no esperan;
 * abrir el modal tampoco arma la espera.
 *
 * Salir de la pantalla: con el modal abierto y un pago en vuelo o por confirmar, un
 * guardia de proceso (`ProcessGuard`) pregunta antes de seguir un enlace o de ir
 * ATRÁS. Usa `useRouter` de `next/navigation`, así que el modal necesita el App Router
 * (en tests, simular `next/navigation` si se llega a enviar un pago).
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
   * pago en vuelo el cierre se ignora y no se llama. Con un intento por confirmar sí
   * se puede cerrar: al reabrir sigue ahí. Necesaria si se pasa `open`.
   */
  onOpenChange?: (open: boolean) => void;
  /**
   * Se llama una vez por pago registrado con éxito (también si se confirma al
   * reintentar un intento incierto), con el pago que devolvió el servidor
   * (`pendingBalanceVes` trae el saldo que queda). El modal no se cierra
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

const GUARD_LABELS = { purchase: "Pago en curso", sale: "Cobro en curso" } as const;

const CONNECTION_ERROR_MESSAGE = "No se pudo conectar con el servidor.";

const UNCONFIRMED_ATTEMPT_MESSAGE =
  "No pudimos confirmar si el pago se registró. Reintenta: si ya entró, no se duplicará.";

/** Inicio de los mensajes por defecto de zod, en inglés: no se enseñan al usuario. */
const DEFAULT_ISSUE_MESSAGE = /^(Invalid|Too (big|small)|Unrecognized|Required|Expected)\b/;

/**
 * Primer motivo de un 400 de validación (`issues` de zod) con texto propio del
 * servidor, que está en español; los mensajes por defecto de zod se saltan.
 */
function firstIssueMessage(issues: unknown) {
  if (!Array.isArray(issues)) {
    return undefined;
  }

  for (const issue of issues as unknown[]) {
    const message =
      typeof issue === "object" && issue !== null
        ? (issue as { message?: unknown }).message
        : undefined;

    if (typeof message === "string" && message.trim() && !DEFAULT_ISSUE_MESSAGE.test(message)) {
      return message;
    }
  }

  return undefined;
}

/**
 * Texto de un error para el usuario. Los de negocio (`ClientApiError`) traen el mensaje
 * del servidor y se muestran tal cual, seguidos del primer motivo de validación si lo
 * hay; el resto son fallos de red o peticiones abortadas (tiempo límite), cuyo mensaje
 * es el del navegador ("Failed to fetch").
 */
function errorMessageFor(error: Error, connectionMessage: string) {
  if (!(error instanceof ClientApiError)) {
    return connectionMessage;
  }

  const issueMessage = firstIssueMessage(error.issues);

  return issueMessage ? `${error.message} ${issueMessage}` : error.message;
}

/**
 * El servidor pudo haber registrado el pago aunque la respuesta sea un error: fallo de
 * red, petición abortada por tiempo límite, 5xx, 408 y 409.
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
 * Envío de resultado incierto que sigue sin resolver: lo que se envió, con su clave de
 * idempotencia, y lo que mostraba el formulario. El reintento reenvía `input` tal cual.
 */
type UnconfirmedAttempt = {
  clientRequestId: string;
  input: Omit<PaymentCreateInput, "clientRequestId">;
  /** Ya se reintentó y siguió sin saberse si entró: se ofrece descartarlo. */
  retried?: boolean;
  values: PaymentFormValues;
};

type RegisterPaymentFormProps = RegisterPaymentModalProps & {
  /** Guarda (o, con `null`, resuelve) el intento por confirmar de este documento. */
  onUnconfirmedAttemptChange: (attempt: UnconfirmedAttempt | null) => void;
  unconfirmedAttempt: UnconfirmedAttempt | null;
};

/**
 * El estado del formulario vive en `RegisterPaymentForm`, que se monta de nuevo con
 * cada documento: nada de una venta viaja con otra venta u otra compra. Los intentos
 * por confirmar se guardan aquí, por documento, porque los consumidores que eligen el
 * documento (`/payments`, Saldos) lo quitan al cerrar: si vivieran en el formulario,
 * reabrir el mismo documento estrenaría clave y el mismo pago podría entrar dos veces.
 */
export function RegisterPaymentModal(props: RegisterPaymentModalProps) {
  const documentKey = `sale:${props.saleId ?? ""}|purchase:${props.purchaseId ?? ""}`;
  const [unconfirmedAttempts, setUnconfirmedAttempts] = useState<
    ReadonlyMap<string, UnconfirmedAttempt>
  >(() => new Map());

  return (
    <RegisterPaymentForm
      key={documentKey}
      {...props}
      onUnconfirmedAttemptChange={(attempt) =>
        setUnconfirmedAttempts((current) => {
          const next = new Map(current);

          if (attempt) {
            next.set(documentKey, attempt);
          } else {
            next.delete(documentKey);
          }

          return next;
        })
      }
      unconfirmedAttempt={unconfirmedAttempts.get(documentKey) ?? null}
    />
  );
}

function RegisterPaymentForm({
  onOpenChange,
  onRegistered,
  onUnconfirmedAttemptChange,
  open: controlledOpen,
  purchaseId,
  saleId,
  submitLabel,
  title,
  trigger,
  unconfirmedAttempt,
}: RegisterPaymentFormProps) {
  const formId = useId();
  // Exactamente un documento: sin ninguno, o con los dos, no se envía nada.
  const fixedDocument: DocumentType | undefined =
    purchaseId && !saleId ? "purchase" : saleId && !purchaseId ? "sale" : undefined;
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? controlledOpen : internalOpen;
  const [renderedOpen, setRenderedOpen] = useState(open);
  // Un documento con un intento por confirmar se vuelve a montar con lo que se envió.
  const [storedValues, setValues] = useState<PaymentFormValues>(
    () => unconfirmedAttempt?.values ?? createEmptyPaymentFormValues(),
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
  const [isDiscardOpen, setIsDiscardOpen] = useState(false);
  const canDiscard = unconfirmedAttempt?.retried === true;
  // Todo lo que cambia qué hace o qué botones tiene el pie: tras cada cambio el modal
  // ignora un instante el segundo clic de un doble clic. Abrirlo no cuenta.
  const stepGuard = useStepClickGuard(
    [createPayment.isPending, unconfirmedAttempt !== null, canDiscard].join("|"),
    { enabled: open },
  );
  // Lo mismo para la confirmación de descarte, que se abre encima del botón pulsado.
  const discardGuard = useStepClickGuard(isDiscardOpen ? "open" : "closed", { enabled: open });
  const enabledPaymentMethodsQuery = useEnabledPaymentMethods();
  const enabledMethods = useMemo(
    () =>
      filterEnabledPaymentMethods(
        enabledPaymentMethodsQuery.data ?? DEFAULT_ENABLED_PAYMENT_METHODS,
      ),
    [enabledPaymentMethodsQuery.data],
  );
  // Sin la lista de la tienda se ofrecen todos (el servidor valida el pago), pero se avisa.
  const enabledMethodsUnknown =
    enabledPaymentMethodsQuery.isError && enabledPaymentMethodsQuery.data === undefined;
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

  // Cada apertura y cada cierre dejan el formulario limpio, también cuando quien abre
  // o cierra es el padre con `open`. Con un intento por confirmar no: al reabrir se ve
  // ese intento, no un formulario limpio que saldría con clave nueva.
  if (renderedOpen !== open) {
    setRenderedOpen(open);
    setIsDiscardOpen(false);

    if (!unconfirmedAttempt) {
      clearFields();
      setSuccessBalanceVes(undefined);
      setSubmitError(null);
    }
  }

  // Cada apertura muestra el saldo recién pedido, no el que quedó en caché.
  useEffect(() => {
    if (open) {
      void refetchDocument?.({ cancelRefetch: false });
    }
  }, [open, refetchDocument]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Recién terminado un envío: es el segundo clic (o Enter) de un doble clic.
    if (stepGuard.isGuarded) {
      return;
    }

    const isRetry = unconfirmedAttempt !== null;

    if (!isRetry) {
      setHasSubmitted(true);
      setSuccessBalanceVes(undefined);
    }

    if ((!isRetry && !canSubmit) || submitLockRef.current || createPayment.isPending) {
      return;
    }

    // Clave de idempotencia (PAG-06): una por envío nuevo. El reintento de un intento
    // por confirmar reenvía lo mismo con la misma clave, sin releer el formulario.
    const attempt: UnconfirmedAttempt = unconfirmedAttempt ?? {
      clientRequestId: crypto.randomUUID(),
      input: { ...buildPaymentFormPayload(values), purchaseId, saleId },
      values,
    };

    submitLockRef.current = true;
    setSubmitError(null);

    let payment: PaymentDetail;

    try {
      payment = await createPayment.mutateAsync({
        ...attempt.input,
        clientRequestId: attempt.clientRequestId,
      });
    } catch (error) {
      // Un 409 al repetir el mismo contenido con la misma clave no debería darse: se
      // trata como rechazo definitivo para no dejar el modal atascado en esa clave.
      const isUncertain =
        isUncertainResult(error) &&
        !(isRetry && error instanceof ClientApiError && error.status === 409);

      onUnconfirmedAttemptChange(isUncertain ? { ...attempt, retried: isRetry } : null);
      setSubmitError(error instanceof Error ? error : new Error(String(error)));
      // Se vuelve a pedir el documento: tras un rechazo el saldo en pantalla puede
      // estar viejo (sobrepago) y tras un resultado incierto el pago pudo entrar.
      void queryClient.invalidateQueries({
        queryKey: fixedDocument === "sale" ? salesQueryKeys.all : purchasesQueryKeys.all,
      });

      if (isUncertain) {
        void queryClient.invalidateQueries({ queryKey: paymentsQueryKeys.all });
      }

      return;
    } finally {
      submitLockRef.current = false;
    }

    onUnconfirmedAttemptChange(null);
    setSuccessBalanceVes(payment.pendingBalanceVes);
    clearFields();
    onRegistered?.(payment);
  }

  /**
   * Suelta el intento por confirmar sin saber si entró: formulario limpio, saldo y
   * pagos recién pedidos y, en el siguiente envío, clave nueva.
   */
  function handleDiscard() {
    if (!unconfirmedAttempt || submitLockRef.current) {
      return;
    }

    setIsDiscardOpen(false);
    onUnconfirmedAttemptChange(null);
    setSubmitError(null);
    clearFields();
    void queryClient.invalidateQueries({
      queryKey: fixedDocument === "sale" ? salesQueryKeys.all : purchasesQueryKeys.all,
    });
    void queryClient.invalidateQueries({ queryKey: paymentsQueryKeys.all });
  }

  /** "Venta F-0002" / "Compra C-0002"; sin número cargado, "este documento". */
  function documentLabel() {
    if (fixedDocument === "sale" && sale.data?.invoiceNumber) {
      return `Venta ${sale.data.invoiceNumber}`;
    }

    if (fixedDocument === "purchase" && purchase.data?.purchaseNumber) {
      return `Compra ${purchase.data.purchaseNumber}`;
    }

    return "este documento";
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

  // Con un intento por confirmar se enseña lo que se envió, no lo que hubiera ahora.
  const shownValues = unconfirmedAttempt?.values ?? values;
  // Recién terminado un envío la acción principal y "Descartar intento" no aceptan
  // clics: el segundo de un doble clic caería en el botón que ahora ocupa el sitio del
  // que se pulsó. "Cancelar" no cambia de sitio ni de función: no espera.
  const footerBusy = createPayment.isPending || stepGuard.isGuarded;
  const submitButtonLabel = createPayment.isPending
    ? "Registrando..."
    : unconfirmedAttempt
      ? "Reintentar"
      : resolvedSubmitLabel;

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
          {canDiscard ? (
            <Button
              disabled={footerBusy}
              onClick={() => setIsDiscardOpen(true)}
              type="button"
              variant="outline"
            >
              Descartar intento
            </Button>
          ) : null}
          <Button
            disabled={
              footerBusy || (!unconfirmedAttempt && (balanceIsLoading || dayRateIsLoading))
            }
            form={formId}
            type="submit"
          >
            {submitButtonLabel}
          </Button>
        </>
      )}
      onOpenChange={(nextOpen) => {
        // Con el pago en vuelo no se cierra (Esc, X, clic fuera): al reabrir, el
        // formulario limpio invitaría a registrarlo otra vez.
        if (!nextOpen && (createPayment.isPending || submitLockRef.current)) {
          return;
        }

        // Recién terminado un envío el modal cambia de alto: el segundo clic de un doble
        // clic cae en el fondo y lo cerraría sin enseñar el resultado.
        if (!nextOpen && stepGuard.ignoresOutsideClose()) {
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
            {/* Con un intento por confirmar el único "Reintentar" es el del pago, que
                también vuelve a pedir el saldo. */}
            {unconfirmedAttempt ? null : (
              <Button
                onClick={() => void linkedDocument?.refetch()}
                size="sm"
                type="button"
                variant="outline"
              >
                Reintentar
              </Button>
            )}
          </div>
        ) : null}

        {hasSubmitted && !hasDocument ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            El pago debe estar asociado solo a una venta o solo a una compra.
          </p>
        ) : null}

        {enabledMethodsUnknown ? (
          <p
            className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200"
            role="status"
          >
            No se pudieron cargar los métodos de pago habilitados de la tienda. Se muestran
            todos: confirma que el método elegido esté habilitado.
          </p>
        ) : null}

        {/* Por confirmar: campos bloqueados con lo enviado, sin atajos ni avisos de un
            saldo que ya pudo cambiar. */}
        <fieldset className="min-w-0" disabled={unconfirmedAttempt !== null}>
          <PaymentFormFields
            methods={enabledMethods}
            onChange={setValues}
            overpayToleranceVes={overpayToleranceVes}
            pendingBalance={unconfirmedAttempt ? undefined : pendingBalanceVes}
            rateVes={rateVes}
            showErrors={hasSubmitted && !unconfirmedAttempt}
            values={shownValues}
          />
        </fieldset>

        {successBalanceVes !== undefined ? (
          <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">
            Pago registrado. Saldo pendiente: {formatVes(successBalanceVes)}
          </p>
        ) : null}

        {unconfirmedAttempt ? (
          <p
            className="rounded-md bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200"
            role="status"
          >
            {UNCONFIRMED_ATTEMPT_MESSAGE}
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

      {unconfirmedAttempt && canDiscard ? (
        <ConfirmActionModal
          confirmLabel="Descartar intento"
          description={`No sabemos si se registró el pago de ${documentLabel()} por ${
            getPaymentCurrency(unconfirmedAttempt.input.method) === "USD"
              ? formatRefUsd(unconfirmedAttempt.input.amount)
              : formatVes(unconfirmedAttempt.input.amount)
          }. Al descartarlo podrás registrar otro.`}
          onConfirm={() => {
            // Segundo clic del doble clic que abrió la confirmación: no confirma. La
            // promesa resuelta hace que `ConfirmActionModal` suelte su botón al momento.
            if (discardGuard.isGuarded) {
              return Promise.resolve();
            }

            handleDiscard();
          }}
          onOpenChange={(nextOpen) => {
            if (!nextOpen && discardGuard.ignoresOutsideClose()) {
              return;
            }

            setIsDiscardOpen(nextOpen);
          }}
          open={isDiscardOpen}
          title="Descartar intento"
          variant="danger"
        >
          <p>
            Revisa antes los pagos del documento: si ese pago sí entró y registras otro,
            quedará duplicado.
          </p>
        </ConfirmActionModal>
      ) : null}

      {/* U6: guardia solo con el modal abierto (este contenido no se pinta cerrado) y un
          pago en vuelo o por confirmar; con el formulario limpio y tras el éxito no hay. */}
      {fixedDocument && (createPayment.isPending || unconfirmedAttempt) ? (
        <ProcessGuard
          active
          description="Todavía no sabemos si se registró. Si sales, revisa los pagos del documento antes de repetirlo."
          label={GUARD_LABELS[fixedDocument]}
          onLeave="discard"
        />
      ) : null}
    </Modal>
  );
}
