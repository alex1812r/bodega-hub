"use client";

import { type FormEvent, type ReactNode, useId, useMemo, useRef, useState } from "react";

import { usePurchase } from "@/modules/purchases/hooks/usePurchases";
import { useSale } from "@/modules/sales/hooks/useSales";
import { Button } from "@/shared/components/Button";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";
import { SelectField } from "@/shared/components/SelectField";
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

import { useCreatePayment } from "../hooks/usePayments";
import { useEnabledPaymentMethods } from "@/modules/settings/hooks/useSettings";
import {
  DEFAULT_ENABLED_PAYMENT_METHODS,
  filterEnabledPaymentMethods,
} from "@/shared/payments/paymentMethods";

type RegisterPaymentModalProps = {
  allowPurchaseContext?: boolean;
  purchaseId?: string;
  saleId?: string;
  trigger?: ReactNode;
};

type ContextType = "purchase" | "sale";

/**
 * Bs por encima del saldo que `register_payment` todavía acepta (guardas F2/F3 de
 * `20260904-payment-guards.sql`); más allá responde 400, así que no se envía.
 * - Venta: el "redondeo a favor", Bs 10 (o 1 % de la tasa) y 1 USD en efectivo USD.
 * - Compra en Bs: el céntimo de la conversión.
 * - Compra en USD: el servidor convierte con la tasa del día, que aquí no se conoce
 *   → `undefined`: superar el saldo solo se avisa y decide el servidor.
 */
function serverOverpayToleranceVes(
  document: "purchase" | "sale" | undefined,
  currency: "USD" | "VES",
  rateVes: number | undefined,
): number | undefined {
  if (document === "purchase") {
    return currency === "VES" ? 0.01 : undefined;
  }

  if (document !== "sale" || !rateVes || rateVes <= 0) {
    return undefined;
  }

  const roundingVes = Math.max(10, roundMoney(0.01 * rateVes));

  return currency === "USD" ? Math.max(roundingVes, roundMoney(rateVes)) : roundingVes;
}

export function RegisterPaymentModal({
  allowPurchaseContext = true,
  purchaseId,
  saleId,
  trigger,
}: RegisterPaymentModalProps) {
  const formId = useId();
  const resolvedPurchaseId = allowPurchaseContext ? purchaseId : undefined;
  const hasFixedContext = Boolean(saleId || resolvedPurchaseId);
  const [open, setOpen] = useState(false);
  const [contextType, setContextType] = useState<ContextType>(
    resolvedPurchaseId ? "purchase" : "sale",
  );
  const [contextId, setContextId] = useState(saleId ?? resolvedPurchaseId ?? "");
  const [storedValues, setValues] = useState<PaymentFormValues>(() =>
    createEmptyPaymentFormValues(),
  );
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [successBalanceVes, setSuccessBalanceVes] = useState<number | undefined>();
  const createPayment = useCreatePayment();
  // Candado contra reentrada: `isPending` no cambia hasta el siguiente render, y dos
  // envíos en el mismo tick registrarían el pago dos veces (no hay idempotencia).
  const submitLockRef = useRef(false);
  const enabledPaymentMethodsQuery = useEnabledPaymentMethods();
  const enabledMethods = useMemo(
    () =>
      filterEnabledPaymentMethods(
        enabledPaymentMethodsQuery.data ?? DEFAULT_ENABLED_PAYMENT_METHODS,
      ),
    [enabledPaymentMethodsQuery.data],
  );
  const selectedSaleId = saleId ?? (contextType === "sale" ? contextId : undefined);
  const selectedPurchaseId =
    resolvedPurchaseId ??
    (allowPurchaseContext && contextType === "purchase" ? contextId : undefined);
  const sale = useSale(selectedSaleId);
  const purchase = usePurchase(selectedPurchaseId);
  const pendingBalanceVes = useMemo(() => {
    if (sale.data) {
      return Math.max(sale.data.totalVes - sale.data.paidVes, 0);
    }

    if (purchase.data) {
      return Math.max(purchase.data.totalVes - purchase.data.paidVes, 0);
    }

    return undefined;
  }, [purchase.data, sale.data]);
  const rateVes = sale.data?.refRateVes ?? purchase.data?.refRateVes;
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
  );
  const contextIsValid = Boolean(selectedSaleId) !== Boolean(selectedPurchaseId);
  // Sin el saldo no hay guarda de sobrepago: mientras el documento carga no se envía;
  // si la carga falló se avisa y decide el servidor (`register_payment`).
  const linkedDocument = selectedSaleId ? sale : selectedPurchaseId ? purchase : undefined;
  const balanceIsLoading = Boolean(linkedDocument?.isPending);
  const balanceError = linkedDocument?.data === undefined ? linkedDocument?.error : null;
  const canSubmit =
    contextIsValid &&
    !balanceIsLoading &&
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

  function resetForm() {
    clearFields();
    setSuccessBalanceVes(undefined);
    createPayment.reset();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHasSubmitted(true);
    setSuccessBalanceVes(undefined);

    if (!canSubmit || submitLockRef.current || createPayment.isPending) {
      return;
    }

    submitLockRef.current = true;

    try {
      const payment = await createPayment.mutateAsync({
        ...buildPaymentFormPayload(values),
        purchaseId: selectedPurchaseId,
        saleId: selectedSaleId,
      });

      setSuccessBalanceVes(payment.pendingBalanceVes);
      clearFields();
    } catch {
      // El mensaje lo pinta `createPayment.error` dentro del formulario.
      return;
    } finally {
      submitLockRef.current = false;
    }
  }

  return (
    <Modal
      description={
        allowPurchaseContext
          ? "Registra un abono asociado a una venta o compra existente."
          : "Registra un abono asociado a una venta existente."
      }
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
            disabled={createPayment.isPending || balanceIsLoading}
            form={formId}
            type="submit"
          >
            {createPayment.isPending ? "Registrando..." : "Registrar pago"}
          </Button>
        </>
      )}
      onOpenChange={(nextOpen) => {
        // Con el pago en vuelo no se cierra (Esc, X, clic fuera): al reabrir, el
        // formulario limpio invitaría a registrarlo otra vez.
        if (!nextOpen && (createPayment.isPending || submitLockRef.current)) {
          return;
        }

        setOpen(nextOpen);
        if (nextOpen) {
          createPayment.reset();
          setSuccessBalanceVes(undefined);
        } else {
          resetForm();
        }
      }}
      open={open}
      title="Registrar pago"
      trigger={trigger ?? <Button size="sm">Registrar pago</Button>}
    >
      <form className="grid gap-4" id={formId} onSubmit={handleSubmit}>
        {!hasFixedContext ? (
          <div className="grid gap-4 md:grid-cols-2">
            {allowPurchaseContext ? (
              <SelectField
                label="Contexto"
                onChange={(event) => {
                  setContextType(event.target.value as ContextType);
                  setContextId("");
                }}
                options={[
                  { label: "Venta", value: "sale" },
                  { label: "Compra", value: "purchase" },
                ]}
                value={contextType}
              />
            ) : null}
            <Input
              error={
                hasSubmitted && !contextIsValid
                  ? "Indica una venta."
                  : undefined
              }
              label={contextType === "sale" || !allowPurchaseContext ? "ID venta" : "ID compra"}
              onChange={(event) => setContextId(event.target.value)}
              placeholder={
                contextType === "sale" || !allowPurchaseContext ? "sale-002" : "purchase-002"
              }
              value={contextId}
            />
          </div>
        ) : null}

        {pendingBalanceVes !== undefined ? (
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

        {balanceError ? (
          <div
            className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200"
            role="alert"
          >
            <p>No se pudo comprobar el saldo pendiente: {balanceError.message}</p>
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

        {hasSubmitted && !contextIsValid && hasFixedContext ? (
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

        {createPayment.error ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {createPayment.error.message}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
