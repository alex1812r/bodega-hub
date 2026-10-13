"use client";

import { type FormEvent, useId, useMemo, useState } from "react";

import type { PaymentMethod } from "@bodega/core";

import { useCurrentExchangeRate } from "@/modules/settings/hooks/useCurrentExchangeRate";
import { useEnabledPaymentMethods } from "@/modules/settings/hooks/useSettings";
import { useVault } from "@/modules/vault/hooks/useVault";
import { getVaultBalancesState } from "@/modules/vault/vault-home/utils/vaultBalancesState";
import {
  buildVaultBucketConfirmEffects,
  formatVaultAmount,
  vaultBucketLabels,
} from "@/modules/vault/vault-home/utils/vaultEffect";
import {
  ConfirmActionModal,
  type ConfirmActionEffect,
  type ConfirmActionStatus,
} from "@/shared/components/ConfirmActionModal";
import { FormActions } from "@/shared/components/FormActions";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";
import { NumberInput } from "@/shared/components/NumberInput";
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
import { computePayrollVaultEffect } from "../utils/payrollVaultEffect";

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

/**
 * Pago de nómina: el formulario no envía, abre la confirmación con lo que
 * cobra cada cajero y el saldo actual → resultante de la cubeta del baúl.
 */
export function PayrollPayModal({ items, onOpenChange, open }: PayrollPayModalProps) {
  const formId = useId();
  const vault = useVault();
  const [confirmOpen, setConfirmOpen] = useState(false);
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
  /**
   * Los metodos pueden llegar con un monto ya tecleado: si el reemplazo es de otra
   * moneda, la cifra se descarta (igual que en el cambio manual de metodo) para que
   * no se lea ni se envie en una moneda distinta a la que penso el usuario.
   */
  const typedAmount = isUsdMethod(method) === isUsdMethod(selectedMethod) ? amountOverride : null;
  const amount = typedAmount ?? (suggestedTotal > 0 ? suggestedTotal.toFixed(2) : "");

  function resetForm() {
    setAmountOverride(null);
    setBankName("");
    setReference("");
    setHasSubmitted(false);
    setErrorMessage(null);
    setConfirmOpen(false);
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

  /** Monto que viaja por cada recibo, en la moneda del método. */
  function amountFor(item: PayrollItem) {
    return isBulk ? Number(suggestedAmount(item).toFixed(2)) : amountNumber;
  }

  const currency = isUsdMethod(method) ? "ref" : "ves";
  const balances = getVaultBalancesState(vault);
  // Un recibo en cero se marca pagado sin mover el baúl (`pay_payroll_item`).
  const vaultEffect = balances.vault
    ? computePayrollVaultEffect({
        amounts: items.map((item) => (item.totalRef > 0 ? amountFor(item) : 0)),
        direction: "out",
        method,
        vault: balances.vault,
      })
    : null;
  const insufficientBucket = vaultEffect?.insufficient
    ? vaultEffect.buckets.find((bucket) => bucket.key === vaultEffect.bucketKey)
    : undefined;
  // El servidor rechaza el pago si supera el saldo de la cubeta: se frena aquí.
  const confirmStatus: ConfirmActionStatus = insufficientBucket ? "blocked" : balances.status;
  const confirmStatusMessage =
    insufficientBucket && vaultEffect
      ? `El baúl no alcanza: ${insufficientBucket.label} tiene ${formatVaultAmount(insufficientBucket.currency, insufficientBucket.before)} y el pago es de ${formatVaultAmount(vaultEffect.currency, vaultEffect.amount)}.`
      : balances.statusMessage;
  const confirmEffects: ConfirmActionEffect[] | undefined = vaultEffect
    ? [
        {
          after: "Pagado",
          before: "Pendiente",
          label: isBulk ? `${String(items.length)} recibos` : "Recibo",
          tone: "positive",
        },
        ...buildVaultBucketConfirmEffects(vaultEffect.buckets),
      ]
    : undefined;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHasSubmitted(true);
    setErrorMessage(null);

    if (!canSubmit || payItem.isPending) {
      return;
    }

    setConfirmOpen(true);
  }

  async function handleConfirm() {
    try {
      for (const item of items) {
        await payItem.mutateAsync({
          amount: amountFor(item),
          bankName: needsBank(method) ? bankName.trim() : null,
          itemId: item.id,
          method,
          reference: needsReference(method) ? reference.trim() : null,
        });
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "No pudimos registrar el pago de nómina.",
      );
      return;
    }

    onOpenChange(false);
    resetForm();
  }

  return (
    <Modal
      description={
        isBulk
          ? `Se pagarán ${String(items.length)} cajeros con el mismo método, cada uno por su total.`
          : `Pago de comisión de ${items[0]?.fullName ?? "la quincena"}.`
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
      title={isBulk ? "Pagar toda la quincena" : "Pagar comisión"}
    >
      <form className="grid gap-4" id={formId} onSubmit={handleSubmit}>
        <p className="rounded-md bg-indigo-50 px-3 py-2 text-sm text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
          Total a pagar: <strong className="tabular-nums">{formatRefUsd(totalRef)}</strong>
          {rateVes > 0 ? ` · ${formatVesBs(totalRef * rateVes)} a la tasa vigente` : null}
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          <SelectField
            label="Método"
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
            <NumberInput
              decimals={2}
              error={
                hasSubmitted && amountNumber <= 0 ? "Indica un monto mayor a cero." : undefined
              }
              helperText={isUsdMethod(method) ? "Monto en USD." : "Monto en Bs."}
              label="Monto"
              onChange={(event) => {
                // El monto se teclea en la moneda del metodo visible: se fija como elegido.
                setSelectedMethod(method);
                setAmountOverride(event.target.value);
              }}
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
                  ? "Usa una referencia de 4 dígitos."
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
            No hay tasa del día registrada: cárgala en Configuración antes de pagar en Bs.
          </p>
        ) : null}

        {/* Con la confirmación abierta el error se dice en ella; al cancelarla sigue a la vista aquí. */}
        {errorMessage && !confirmOpen ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {errorMessage}
          </p>
        ) : null}
      </form>
      <ConfirmActionModal
        confirmLabel={isBulk ? "Pagar todos" : "Pagar comisión"}
        description={
          vaultEffect
            ? `El dinero sale de ${vaultBucketLabels[vaultEffect.bucketKey]} del baúl por ${paymentMethodLabels[method]}.`
            : `Pago por ${paymentMethodLabels[method]}.`
        }
        effects={confirmEffects}
        error={errorMessage}
        isPending={payItem.isPending}
        onConfirm={handleConfirm}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setConfirmOpen(false);
          }
        }}
        onRetry={() => void vault.refetch()}
        open={confirmOpen}
        status={confirmStatus}
        statusHint={confirmStatus === "loading" ? undefined : "No se ha pagado nada."}
        statusMessage={confirmStatusMessage}
        title={isBulk ? "Confirmar pago de la quincena" : "Confirmar pago de comisión"}
      >
        <div className="space-y-2">
          <ul className="max-h-40 space-y-1 overflow-y-auto">
            {items.map((item) => (
              <li className="flex items-baseline justify-between gap-3" key={item.id}>
                <span className="min-w-0 break-words font-medium text-foreground">
                  {item.fullName}
                </span>
                <span className="shrink-0 tabular-nums text-foreground">
                  {formatVaultAmount(currency, amountFor(item))}
                </span>
              </li>
            ))}
          </ul>
          {needsReference(method) ? (
            <p>
              {bankName.trim()} · referencia {reference.trim()}
            </p>
          ) : null}
          {isBulk ? (
            <p>
              Los pagos se registran uno a uno: si alguno falla, los anteriores quedan pagados.
            </p>
          ) : null}
        </div>
      </ConfirmActionModal>
    </Modal>
  );
}
