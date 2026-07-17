"use client";

import { type FormEvent, type ReactNode, useEffect, useId, useMemo, useState } from "react";

import { usePurchase } from "@/modules/purchases/hooks/usePurchases";
import { useSale } from "@/modules/sales/hooks/useSales";
import { Button } from "@/shared/components/Button";
import { FormActions } from "@/shared/components/FormActions";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";
import { SelectField } from "@/shared/components/SelectField";
import { Textarea } from "@/shared/components/Textarea";
import { VenezuelanBankField } from "@/shared/components/VenezuelanBankField";
import { VenezuelanPhoneField } from "@/shared/components/VenezuelanPhoneField";
import type { PaymentMethod } from "@/shared/mocks/erp-data";
import { formatVes } from "@/shared/utils/currency";
import { isKnownBankLabel } from "@/shared/venezuela/banks";
import { isValidVeMobilePhone } from "@/shared/venezuela/phone";

import { useCreatePayment, type PaymentCreateInput } from "../hooks/usePayments";
import { useEnabledPaymentMethods } from "@/modules/settings/hooks/useSettings";
import {
  DEFAULT_ENABLED_PAYMENT_METHODS,
  filterEnabledPaymentMethods,
  paymentMethodLabels,
} from "@/shared/payments/paymentMethods";

type RegisterPaymentModalProps = {
  purchaseId?: string;
  saleId?: string;
  trigger?: ReactNode;
};

type ContextType = "purchase" | "sale";

function getCurrency(method: PaymentMethod): PaymentCreateInput["currency"] {
  if (method === "efectivo_usd") {
    return "USD";
  }

  return "VES";
}

function needsBank(method: PaymentMethod) {
  return method === "pago_movil" || method === "transferencia";
}

function needsPhone(method: PaymentMethod) {
  return method === "pago_movil";
}

function needsReference(method: PaymentMethod) {
  return method === "pago_movil" || method === "punto_venta" || method === "transferencia";
}

export function RegisterPaymentModal({
  purchaseId,
  saleId,
  trigger,
}: RegisterPaymentModalProps) {
  const formId = useId();
  const hasFixedContext = Boolean(saleId || purchaseId);
  const [open, setOpen] = useState(false);
  const [contextType, setContextType] = useState<ContextType>(
    purchaseId ? "purchase" : "sale",
  );
  const [contextId, setContextId] = useState(saleId ?? purchaseId ?? "");
  const [method, setMethod] = useState<PaymentMethod>("efectivo_ves");
  const [amount, setAmount] = useState("");
  const [bankName, setBankName] = useState("");
  const [phone, setPhone] = useState("");
  const [referenceCode, setReferenceCode] = useState("");
  const [notes, setNotes] = useState("");
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [successBalanceVes, setSuccessBalanceVes] = useState<number | undefined>();
  const createPayment = useCreatePayment();
  const enabledPaymentMethodsQuery = useEnabledPaymentMethods();
  const methodOptions = useMemo(() => {
    const enabled =
      enabledPaymentMethodsQuery.data ?? DEFAULT_ENABLED_PAYMENT_METHODS;
    return filterEnabledPaymentMethods(enabled).map((value) => ({
      label: paymentMethodLabels[value],
      value,
    }));
  }, [enabledPaymentMethodsQuery.data]);
  const selectedSaleId = saleId ?? (contextType === "sale" ? contextId : undefined);
  const selectedPurchaseId =
    purchaseId ?? (contextType === "purchase" ? contextId : undefined);
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
  const amountNumber = Number(amount);
  const contextIsValid = Boolean(selectedSaleId) !== Boolean(selectedPurchaseId);
  const referenceIsValid =
    !needsReference(method) ||
    (method === "pago_movil"
      ? /^\d{4}$/.test(referenceCode.trim())
      : Boolean(referenceCode.trim()));
  const bankIsValid = !needsBank(method) || isKnownBankLabel(bankName);
  const phoneIsValid = !needsPhone(method) || isValidVeMobilePhone(phone);
  const canSubmit =
    contextIsValid &&
    amountNumber > 0 &&
    bankIsValid &&
    phoneIsValid &&
    referenceIsValid &&
    methodOptions.some((option) => option.value === method);

  useEffect(() => {
    if (methodOptions.length === 0) {
      return;
    }

    if (!methodOptions.some((option) => option.value === method)) {
      setMethod(methodOptions[0].value);
    }
  }, [method, methodOptions]);

  function resetForm() {
    setAmount("");
    setBankName("");
    setPhone("");
    setReferenceCode("");
    setNotes("");
    setHasSubmitted(false);
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
        amount: amountNumber,
        bankName: bankName.trim() || undefined,
        currency: getCurrency(method),
        method,
        notes: notes.trim() || undefined,
        phone: phone.trim() || undefined,
        purchaseId: selectedPurchaseId,
        referenceCode: referenceCode.trim() || undefined,
        saleId: selectedSaleId,
      });

      setSuccessBalanceVes(payment.pendingBalanceVes);
      setAmount("");
      setBankName("");
      setPhone("");
      setReferenceCode("");
      setNotes("");
      setHasSubmitted(false);
    } catch {
      return;
    }
  }

  return (
    <Modal
      description="Registra un abono asociado a una venta o compra existente."
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
            <Input
              error={
                hasSubmitted && !contextIsValid
                  ? "Indica una venta o compra."
                  : undefined
              }
              label={contextType === "sale" ? "ID venta" : "ID compra"}
              onChange={(event) => setContextId(event.target.value)}
              placeholder={contextType === "sale" ? "sale-002" : "purchase-002"}
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

        <div className="grid gap-4 md:grid-cols-2">
          <SelectField
            label="Metodo"
            onChange={(event) => {
              setMethod(event.target.value as PaymentMethod);
              setBankName("");
              setPhone("");
              setReferenceCode("");
            }}
            options={methodOptions}
            value={method}
          />
          <Input
            error={
              hasSubmitted && amountNumber <= 0
                ? "Indica un monto mayor a cero."
                : undefined
            }
            helperText={method === "efectivo_usd" ? "Monto en USD." : "Monto en VES."}
            label="Monto"
            min="0"
            onChange={(event) => setAmount(event.target.value)}
            step="0.01"
            type="number"
            value={amount}
          />
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

        {needsPhone(method) ? (
          <VenezuelanPhoneField
            error={
              hasSubmitted && !phoneIsValid
                ? phone.trim()
                  ? "Telefono invalido (ej. 0412 555-1234)."
                  : "Indica el telefono."
                : undefined
            }
            onChange={setPhone}
            value={phone}
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
            onChange={(event) => setReferenceCode(event.target.value)}
            placeholder={method === "pago_movil" ? "1234" : "TRX-001"}
            value={referenceCode}
          />
        ) : null}

        <Textarea
          label="Notas"
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Observaciones internas"
          value={notes}
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
