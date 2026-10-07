"use client";

import { type FormEvent, type ReactNode, useId, useMemo, useState } from "react";

import { usePurchase } from "@/modules/purchases/hooks/usePurchases";
import { useSale } from "@/modules/sales/hooks/useSales";
import { Button } from "@/shared/components/Button";
import { FormActions } from "@/shared/components/FormActions";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";
import { SelectField } from "@/shared/components/SelectField";
import {
  PaymentFormFields,
  type PaymentFormValues,
  buildPaymentFormPayload,
  createEmptyPaymentFormValues,
  isPaymentFormValid,
} from "@/shared/payments/PaymentFormFields";
import { formatVes } from "@/shared/utils/currency";

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
  const enabledPaymentMethodsQuery = useEnabledPaymentMethods();
  const enabledMethods = useMemo(
    () =>
      filterEnabledPaymentMethods(
        enabledPaymentMethodsQuery.data ?? DEFAULT_ENABLED_PAYMENT_METHODS,
      ),
    [enabledPaymentMethodsQuery.data],
  );
  // Si la tienda no tiene habilitado el método elegido, se usa el primero habilitado.
  const values = useMemo<PaymentFormValues>(
    () =>
      enabledMethods.length === 0 || enabledMethods.includes(storedValues.method)
        ? storedValues
        : { ...storedValues, method: enabledMethods[0] },
    [enabledMethods, storedValues],
  );
  const { method } = values;
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
  const contextIsValid = Boolean(selectedSaleId) !== Boolean(selectedPurchaseId);
  const canSubmit =
    contextIsValid && isPaymentFormValid(values) && enabledMethods.includes(method);

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

    if (!canSubmit) {
      return;
    }

    try {
      const payment = await createPayment.mutateAsync({
        ...buildPaymentFormPayload(values),
        purchaseId: selectedPurchaseId,
        saleId: selectedSaleId,
      });

      setSuccessBalanceVes(payment.pendingBalanceVes);
      clearFields();
    } catch {
      return;
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
        <FormActions
          isSubmitting={createPayment.isPending}
          onCancel={close}
          submitFormId={formId}
          submitLabel="Registrar pago"
          submittingLabel="Registrando..."
        />
      )}
      onOpenChange={(nextOpen) => {
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

        {hasSubmitted && !contextIsValid && hasFixedContext ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            El pago debe estar asociado solo a una venta o solo a una compra.
          </p>
        ) : null}

        <PaymentFormFields
          methods={enabledMethods}
          onChange={setValues}
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
