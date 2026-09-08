"use client";

import { type FormEvent, useId, useMemo, useState } from "react";

import type { PaymentMethod } from "@bodega/core";

import { useCurrentExchangeRate } from "@/modules/settings/hooks/useCurrentExchangeRate";
import { useEnabledPaymentMethods } from "@/modules/settings/hooks/useSettings";
import { FormActions } from "@/shared/components/FormActions";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";
import { SelectField } from "@/shared/components/SelectField";
import { VenezuelanBankField } from "@/shared/components/VenezuelanBankField";
import {
  DEFAULT_ENABLED_PAYMENT_METHODS,
  filterEnabledPaymentMethods,
  paymentMethodLabels,
} from "@/shared/payments/paymentMethods";
import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";
import { isKnownBankLabel } from "@/shared/venezuela/banks";

import { usePayPayrollItem } from "../../hooks/usePayroll";
import type { PayrollItem } from "../../types";

/** §3 del plan: la nomina se paga solo por estos cuatro metodos. */
const PAYROLL_PAYMENT_METHODS: PaymentMethod[] = [
  "efectivo_ves",
  "efectivo_usd",
  "pago_movil",
  "transferencia",
];

type PayrollPayModalProps = {
  /** Uno = pago individual. Varios = "Pagar todos" (se pagan en secuencia). */
  items: PayrollItem[];
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

function needsBank(method: PaymentMethod) {
  return method === "pago_movil" || method === "transferencia";
}

function needsReference(method: PaymentMethod) {
  return method === "pago_movil" || method === "transferencia";
}

function isUsdMethod(method: PaymentMethod) {
  return method === "efectivo_usd";
}

export function PayrollPayModal({ items, onOpenChange, open }: PayrollPayModalProps) {
  const formId = useId();
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>("efectivo_ves");
  /** `null` = todavia vale el monto sugerido; una cadena = lo que escribio el usuario. */
  const [amountOverride, setAmountOverride] = useState<string | null>(null);
  const [bankName, setBankName] = useState("");
  const [reference, setReference] = useState("");
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const payItem = usePayPayrollItem();
  const enabledPaymentMethodsQuery = useEnabledPaymentMethods();
  const exchangeRateQuery = useCurrentExchangeRate();
  const rateVes = exchangeRateQuery.data?.rateVes ?? 0;
  const isBulk = items.length > 1;
  const totalRef = useMemo(
    () => items.reduce((accumulator, item) => accumulator + item.totalRef, 0),
    [items],
  );
  const methodOptions = useMemo(() => {
    const enabled = enabledPaymentMethodsQuery.data ?? DEFAULT_ENABLED_PAYMENT_METHODS;

    return filterEnabledPaymentMethods(enabled, PAYROLL_PAYMENT_METHODS).map((value) => ({
      label: paymentMethodLabels[value],
      value,
    }));
  }, [enabledPaymentMethodsQuery.data]);
  /** Si la tienda deshabilito el metodo elegido, cae al primero disponible. */
  const method = methodOptions.some((option) => option.value === selectedMethod)
    ? selectedMethod
    : (methodOptions[0]?.value ?? selectedMethod);

  /** Monto sugerido para un item, en la moneda del metodo elegido. */
  function suggestedAmount(item: PayrollItem) {
    return isUsdMethod(method) ? item.totalRef : item.totalRef * rateVes;
  }

  const suggestedTotal = isUsdMethod(method) ? totalRef : totalRef * rateVes;
  const amount = amountOverride ?? (suggestedTotal > 0 ? suggestedTotal.toFixed(2) : "");

  function resetForm() {
    setAmountOverride(null);
    setBankName("");
    setReference("");
    setHasSubmitted(false);
    setErrorMessage(null);
    payItem.reset();
  }

  const amountNumber = Number(amount);
  const bankIsValid = !needsBank(method) || isKnownBankLabel(bankName);
  const referenceIsValid =
    !needsReference(method) ||
    (method === "pago_movil" ? /^\d{4}$/.test(reference.trim()) : Boolean(reference.trim()));
  const amountIsValid = isBulk ? totalRef >= 0 : amountNumber > 0;
  const needsRate = !isUsdMethod(method) && rateVes <= 0;
  const canSubmit =
    amountIsValid &&
    bankIsValid &&
    referenceIsValid &&
    !needsRate &&
    methodOptions.length > 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHasSubmitted(true);
    setErrorMessage(null);

    if (!canSubmit) {
      return;
    }

    try {
      for (const item of items) {
        await payItem.mutateAsync({
          amount: isBulk ? Number(suggestedAmount(item).toFixed(2)) : amountNumber,
          bankName: needsBank(method) ? bankName.trim() : null,
          itemId: item.id,
          method,
          reference: needsReference(method) ? reference.trim() : null,
        });
      }

      onOpenChange(false);
      resetForm();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "No pudimos registrar el pago de nomina.",
      );
    }
  }

  return (
    <Modal
      description={
        isBulk
          ? `Se pagaran ${String(items.length)} cajeros con el mismo metodo, cada uno por su total.`
          : `Pago de comision de ${items[0]?.fullName ?? "la quincena"}.`
      }
      footer={({ close }) => (
        <FormActions
          isSubmitting={payItem.isPending}
          onCancel={() => {
            resetForm();
            close();
          }}
          submitFormId={formId}
          submitLabel={isBulk ? "Pagar todos" : "Registrar pago"}
          submittingLabel="Pagando..."
        />
      )}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);

        if (!nextOpen) {
          resetForm();
        }
      }}
      open={open}
      title={isBulk ? "Pagar toda la quincena" : "Pagar comision"}
    >
      <form className="grid gap-4" id={formId} onSubmit={handleSubmit}>
        <p className="rounded-md bg-indigo-50 px-3 py-2 text-sm text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
          Total a pagar: <strong className="tabular-nums">{formatRefUsd(totalRef)}</strong>
          {rateVes > 0 ? ` · ${formatVesBs(totalRef * rateVes)} a la tasa vigente` : null}
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          <SelectField
            label="Metodo"
            onChange={(event) => {
              setSelectedMethod(event.target.value as PaymentMethod);
              setAmountOverride(null);
              setBankName("");
              setReference("");
            }}
            options={methodOptions}
            value={method}
          />
          {isBulk ? (
            <Input
              disabled
              helperText="En pago masivo cada cajero cobra su propio total."
              label="Monto"
              readOnly
              value={suggestedTotal.toFixed(2)}
            />
          ) : (
            <Input
              error={
                hasSubmitted && amountNumber <= 0 ? "Indica un monto mayor a cero." : undefined
              }
              helperText={isUsdMethod(method) ? "Monto en USD." : "Monto en Bs."}
              label="Monto"
              min="0"
              onChange={(event) => setAmountOverride(event.target.value)}
              step="0.01"
              type="number"
              value={amount}
            />
          )}
        </div>

        {needsBank(method) ? (
          <VenezuelanBankField
            error={
              hasSubmitted && !bankIsValid
                ? bankName.trim()
                  ? "Selecciona un banco de la lista."
                  : "Indica el banco."
                : undefined
            }
            onChange={setBankName}
            value={bankName}
          />
        ) : null}

        {needsReference(method) ? (
          <Input
            error={
              hasSubmitted && !referenceIsValid
                ? method === "pago_movil"
                  ? "Usa una referencia de 4 digitos."
                  : "Indica la referencia."
                : undefined
            }
            label="Referencia"
            onChange={(event) => setReference(event.target.value)}
            placeholder={method === "pago_movil" ? "1234" : "TRX-001"}
            value={reference}
          />
        ) : null}

        {needsRate ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-950 dark:text-amber-300">
            No hay tasa del dia registrada: cargala en Configuracion antes de pagar en Bs.
          </p>
        ) : null}

        {errorMessage ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {errorMessage}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
