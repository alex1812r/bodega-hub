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
  amountForPendingShare,
  getPaymentCurrency,
  paymentAmountEquivalent,
  paymentNeedsBank,
  paymentNeedsPhone,
  paymentNeedsReference,
  validatePaymentForm,
} from "./paymentForm";

export type PaymentFormFieldsProps = {
  /** Métodos que se ofrecen en el selector, en el orden recibido. */
  methods: readonly PaymentMethod[];
  /** Recibe el estado completo siguiente. Cambiar de método limpia banco, teléfono y referencia. */
  onChange: (values: PaymentFormValues) => void;
  /** Saldo pendiente del documento en Bs. Sin él no hay "Completar saldo" ni chips. */
  pendingBalance?: number;
  /** Tasa Bs por REF del documento. Sin ella no hay equivalencia ni atajos en REF. */
  rateVes?: number;
  /** Muestra las validaciones por campo (normalmente tras intentar enviar). */
  showErrors?: boolean;
  values: PaymentFormValues;
};

const chipClassName =
  "inline-flex h-7 cursor-pointer items-center rounded-full border border-border bg-surface-container-lowest px-3 text-xs font-medium text-foreground transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50";

const completeClassName =
  "inline-flex h-7 cursor-pointer items-center rounded-full bg-primary/10 px-3 text-xs font-semibold text-primary transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50";

export function PaymentFormFields({
  methods,
  onChange,
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
  const errors = showErrors ? validatePaymentForm(values) : {};
  const equivalent = paymentAmountEquivalent(method, amount, rateVes);
  const currencyHelper =
    getPaymentCurrency(method) === "USD" ? "Monto en USD." : "Monto en VES.";
  const hasPendingBalance = pendingBalance !== undefined && pendingBalance > 0;

  function update(patch: Partial<PaymentFormValues>) {
    onChange({ ...values, ...patch });
  }

  function shareAmount(percent: number) {
    return amountForPendingShare(method, pendingBalance, percent, rateVes);
  }

  function applyShare(percent: number) {
    const next = shareAmount(percent);

    if (next !== null) {
      update({ amount: String(next) });
    }
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <SelectField
          label="Metodo"
          onChange={(event) =>
            update({
              bankName: "",
              method: event.target.value as PaymentMethod,
              phone: "",
              referenceCode: "",
            })
          }
          options={methodOptions}
          value={method}
        />
        <NumberInput
          decimals={2}
          error={errors.amount}
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
