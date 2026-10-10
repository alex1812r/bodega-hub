"use client";

import { useMemo } from "react";

import { Input } from "@/shared/components/Input";
import { NumberInput } from "@/shared/components/NumberInput";
import { SelectField } from "@/shared/components/SelectField";
import { Textarea } from "@/shared/components/Textarea";
import { VenezuelanBankField } from "@/shared/components/VenezuelanBankField";
import { VenezuelanPhoneField } from "@/shared/components/VenezuelanPhoneField";
import type { PaymentMethod } from "@/shared/mocks/erp-data";
import { paymentMethodLabels } from "@/shared/payments/paymentMethods";
import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";

import {
  PENDING_BALANCE_SHARES,
  type PaymentFormValues,
  amountForMethodChange,
  amountForPendingShare,
  getPaymentCurrency,
  paymentAmountEquivalent,
  paymentNeedsBank,
  paymentNeedsPhone,
  paymentNeedsReference,
  paymentOverpayment,
  validatePaymentForm,
} from "./paymentForm";

export type PaymentFormFieldsProps = {
  /** Métodos que se ofrecen en el selector, en el orden recibido. */
  methods: readonly PaymentMethod[];
  /**
   * Menor saldo en Bs que el servidor aún deja pagar en este documento
   * (`MIN_PAYABLE_VES_BY_DOCUMENT`): "Completar saldo" y los atajos no dejan un
   * resto por debajo. Por defecto Bs 0,01 (compra).
   */
  minPayableVes?: number;
  /**
   * Recibe el estado completo siguiente. Cambiar de método limpia banco, teléfono y
   * referencia; si además cambia la moneda, el monto se convierte con `rateVes` (o se vacía).
   */
  onChange: (values: PaymentFormValues) => void;
  /**
   * Bs por encima del saldo que el servidor aún acepta. Con él, pasarse marca el monto
   * como inválido; sin él, superar el saldo solo se avisa.
   */
  overpayToleranceVes?: number;
  /**
   * Saldo pendiente del documento en Bs. Sin él no hay "Completar saldo", chips ni
   * aviso de monto mayor que el saldo.
   */
  pendingBalance?: number;
  /** Tasa Bs por REF del documento. Sin ella no hay equivalencia ni atajos en REF. */
  rateVes?: number;
  /** Muestra las validaciones por campo (normalmente tras intentar enviar). */
  showErrors?: boolean;
  values: PaymentFormValues;
};

const chipClassName =
  "inline-flex h-7 cursor-pointer items-center rounded-full border border-border bg-surface-container-lowest px-3 text-xs font-medium text-foreground transition-colors hover:border-indigo-700 hover:bg-indigo-50 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:border-indigo-300 dark:hover:bg-indigo-950 dark:hover:text-indigo-300";

const completeClassName =
  "inline-flex h-7 cursor-pointer items-center rounded-full bg-indigo-50 px-3 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-indigo-950 dark:text-indigo-300 dark:hover:bg-indigo-900";

export function PaymentFormFields({
  methods,
  minPayableVes,
  onChange,
  overpayToleranceVes,
  pendingBalance,
  rateVes,
  showErrors = false,
  values,
}: PaymentFormFieldsProps) {
  const { amount, bankName, method, notes, phone, referenceCode } = values;
  const methodOptions = useMemo(
    () => methods.map((value) => ({ label: paymentMethodLabels[value], value })),
    [methods],
  );
  const balance = { overpayToleranceVes, pendingBalance, rateVes };
  const errors = showErrors ? validatePaymentForm(values, balance) : {};
  // El sobrepago se avisa mientras se escribe, sin esperar al intento de envío.
  const overpayment = paymentOverpayment(values, balance);
  const equivalent = paymentAmountEquivalent(method, amount, rateVes);
  const currencyHelper =
    getPaymentCurrency(method) === "USD" ? "Monto en USD." : "Monto en VES.";
  const hasPendingBalance = pendingBalance !== undefined && pendingBalance > 0;

  function update(patch: Partial<PaymentFormValues>) {
    onChange({ ...values, ...patch });
  }

  function shareAmount(percent: number) {
    return amountForPendingShare(method, pendingBalance, percent, rateVes, minPayableVes);
  }

  function applyShare(percent: number) {
    const next = shareAmount(percent);

    if (next !== null) {
      update({ amount: String(next) });
    }
  }

  return (
    // `@container`: las dos columnas dependen del ancho de este bloque, no del de la
    // ventana; en una columna lateral angosta «Método» y «Monto» van uno bajo el otro.
    <div className="@container grid gap-4">
      <div className="grid gap-4 @sm:grid-cols-2">
        <SelectField
          label="Método"
          onChange={(event) => {
            const nextMethod = event.target.value as PaymentMethod;

            update({
              amount: amountForMethodChange(method, nextMethod, amount, rateVes),
              bankName: "",
              method: nextMethod,
              phone: "",
              referenceCode: "",
            });
          }}
          options={methodOptions}
          value={method}
        />
        <NumberInput
          decimals={2}
          error={errors.amount ?? (overpayment?.blocking ? overpayment.message : undefined)}
          helperText={
            equivalent
              ? `${currencyHelper} Equivale a ${
                  equivalent.currency === "VES"
                    ? formatVesBs(equivalent.value)
                    : formatRefUsd(equivalent.value)
                }.`
              : currencyHelper
          }
          label="Monto"
          onChange={(event) => update({ amount: event.target.value })}
          value={amount}
        />
      </div>

      {overpayment && !overpayment.blocking ? (
        <p
          className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200"
          role="status"
        >
          {overpayment.message}
        </p>
      ) : null}

      {hasPendingBalance ? (
        <div
          aria-label="Atajos de saldo pendiente"
          className="flex flex-wrap items-center gap-2"
          role="group"
        >
          <button
            className={completeClassName}
            disabled={shareAmount(100) === null}
            onClick={() => applyShare(100)}
            type="button"
          >
            Completar saldo
          </button>
          {PENDING_BALANCE_SHARES.map((percent) => (
            <button
              aria-label={`${percent} % del saldo`}
              className={chipClassName}
              disabled={shareAmount(percent) === null}
              key={percent}
              onClick={() => applyShare(percent)}
              type="button"
            >
              {percent} %
            </button>
          ))}
        </div>
      ) : null}

      {paymentNeedsBank(method) ? (
        <VenezuelanBankField
          error={errors.bankName}
          onChange={(nextBankName) => update({ bankName: nextBankName })}
          value={bankName}
        />
      ) : null}

      {paymentNeedsPhone(method) ? (
        <VenezuelanPhoneField
          error={errors.phone}
          onChange={(nextPhone) => update({ phone: nextPhone })}
          value={phone}
        />
      ) : null}

      {paymentNeedsReference(method) ? (
        <Input
          error={errors.referenceCode}
          label="Referencia"
          onChange={(event) => update({ referenceCode: event.target.value })}
          placeholder={method === "pago_movil" ? "1234" : "TRX-001"}
          value={referenceCode}
        />
      ) : null}

      <Textarea
        label="Notas"
        onChange={(event) => update({ notes: event.target.value })}
        placeholder="Observaciones internas"
        value={notes}
      />
    </div>
  );
}
