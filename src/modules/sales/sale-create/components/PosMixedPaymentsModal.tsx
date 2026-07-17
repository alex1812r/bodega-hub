"use client";

import { Calculator, Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

import { Button } from "@/shared/components/Button";
import { FormActions } from "@/shared/components/FormActions";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";
import { SelectField } from "@/shared/components/SelectField";
import { VenezuelanBankField } from "@/shared/components/VenezuelanBankField";
import { VenezuelanPhoneField } from "@/shared/components/VenezuelanPhoneField";
import type { PaymentMethod } from "@/shared/mocks/erp-data";
import {
  DEFAULT_ENABLED_PAYMENT_METHODS,
  filterEnabledPaymentMethods,
  paymentMethodLabels,
} from "@/shared/payments/paymentMethods";
import { formatRef, formatVes } from "@/shared/utils/currency";
import { cn } from "@/shared/utils/cn";

import {
  MIXED_PAYMENT_MIN_LINES,
  buildRemainingFillHelperText,
  buildVesAmountHelperText,
  createDefaultMixedPaymentLines,
  createEmptyMixedPaymentLine,
  getAvailablePaymentMethods,
  getMaxMixedPaymentLines,
  getRemainingRef,
  isUsdPaymentMethod,
  needsBank,
  needsPhone,
  needsReference,
  pickNextAvailablePaymentMethod,
  refToPaymentAmount,
  validateMixedPayments,
  type PosMixedPaymentLine,
} from "../utils/mixedPayments";

function toMethodOptions(methods: PaymentMethod[]) {
  return methods.map((value) => ({
    label: paymentMethodLabels[value],
    value,
  }));
}

type PosMixedPaymentsModalProps = {
  enabledPaymentMethods?: readonly PaymentMethod[];
  initialLines?: PosMixedPaymentLine[] | null;
  onConfirm: (lines: PosMixedPaymentLine[]) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  rateVes: number;
  totalRef: number;
  totalVes: number;
};

export function PosMixedPaymentsModal({
  enabledPaymentMethods = DEFAULT_ENABLED_PAYMENT_METHODS,
  initialLines,
  onConfirm,
  onOpenChange,
  open,
  rateVes,
  totalRef,
  totalVes,
}: PosMixedPaymentsModalProps) {
  const formId = useId();
  const [lines, setLines] = useState<PosMixedPaymentLine[]>(() =>
    createDefaultMixedPaymentLines(enabledPaymentMethods),
  );
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const maxLines = getMaxMixedPaymentLines(
    filterEnabledPaymentMethods(enabledPaymentMethods).length,
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    setHasSubmitted(false);
    setLines(
      initialLines && initialLines.length >= MIXED_PAYMENT_MIN_LINES
        ? initialLines.map((line) => ({ ...line }))
        : createDefaultMixedPaymentLines(enabledPaymentMethods),
    );
  }, [enabledPaymentMethods, initialLines, open]);

  const remainingRef = useMemo(
    () => getRemainingRef(totalRef, lines, rateVes),
    [lines, rateVes, totalRef],
  );

  const validation = useMemo(
    () => validateMixedPayments(totalRef, lines, rateVes, enabledPaymentMethods),
    [enabledPaymentMethods, lines, rateVes, totalRef],
  );

  function updateLine(id: string, patch: Partial<PosMixedPaymentLine>) {
    setLines((current) =>
      current.map((line) => (line.id === id ? { ...line, ...patch } : line)),
    );
  }

  function fillRemaining(id: string) {
    setLines((current) => {
      const target = current.find((line) => line.id === id);
      if (!target) {
        return current;
      }

      const remaining = getRemainingRef(totalRef, current, rateVes, id);
      const amount = refToPaymentAmount(target.method, remaining, rateVes);
      return current.map((line) => (line.id === id ? { ...line, amount } : line));
    });
  }

  function handleConfirm() {
    setHasSubmitted(true);
    if (!validation.isValid) {
      return;
    }

    onConfirm(lines);
    onOpenChange(false);
  }

  return (
    <Modal
      contentClassName="sm:max-w-2xl"
      description="Divide el total entre dos o mas metodos. Usa el boton del monto para completar el restante."
      footer={({ close }) => (
        <FormActions
          onCancel={close}
          submitFormId={formId}
          submitLabel="Aplicar pago mixto"
        />
      )}
      onOpenChange={onOpenChange}
      open={open}
      title="Pago mixto"
    >
      <form
        className="space-y-4"
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          handleConfirm();
        }}
      >
        <div className="rounded-lg border border-border bg-surface-container-low px-3 py-2 text-sm dark:border-slate-700">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-medium text-foreground">Total a cubrir</p>
            <div className="text-right">
              <p className="font-semibold text-foreground">{formatRef(totalRef)}</p>
              {rateVes > 0 ? (
                <p className="text-xs text-muted-foreground">{formatVes(totalVes)}</p>
              ) : null}
            </div>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Tasa: {rateVes > 0 ? formatVes(rateVes) : "no disponible"} · Restante:{" "}
            {formatRef(remainingRef)}
          </p>
        </div>

        <div className="space-y-4">
          {lines.map((line, index) => {
            const lineRemaining = getRemainingRef(totalRef, lines, rateVes, line.id);
            const canFill = lineRemaining > 0.01;
            const availableMethods = getAvailablePaymentMethods(
              lines,
              line.id,
              enabledPaymentMethods,
            );
            const lineMethodOptions = toMethodOptions(
              availableMethods.includes(line.method)
                ? availableMethods
                : [line.method, ...availableMethods],
            );
            const helperText = isUsdPaymentMethod(line.method)
              ? buildRemainingFillHelperText(line.method, lineRemaining, rateVes) ??
                "Monto en USD / REF."
              : buildVesAmountHelperText(line.amount, rateVes) ??
                buildRemainingFillHelperText(line.method, lineRemaining, rateVes) ??
                "Monto en VES.";

            return (
              <div
                className="space-y-3 rounded-xl border border-border p-3 dark:border-slate-700"
                key={line.id}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">Metodo {index + 1}</p>
                  {lines.length > MIXED_PAYMENT_MIN_LINES ? (
                    <button
                      aria-label={`Quitar metodo ${index + 1}`}
                      className="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-surface-container hover:text-destructive"
                      onClick={() =>
                        setLines((current) => current.filter((item) => item.id !== line.id))
                      }
                      type="button"
                    >
                      <Trash2 aria-hidden className="size-3.5" />
                      Quitar
                    </button>
                  ) : null}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <SelectField
                    label="Metodo"
                    onChange={(event) => {
                      const method = event.target.value as PaymentMethod;
                      updateLine(line.id, {
                        bankName: "",
                        method,
                        phone: "",
                        referenceCode: "",
                      });
                    }}
                    options={lineMethodOptions}
                    value={line.method}
                  />
                  <Input
                    helperText={helperText}
                    label="Monto"
                    min="0"
                    onChange={(event) =>
                      updateLine(line.id, {
                        amount: Number(event.target.value) || 0,
                      })
                    }
                    step="0.01"
                    trailing={
                      <button
                        aria-label="Completar restante"
                        className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={!canFill || rateVes <= 0}
                        onClick={() => fillRemaining(line.id)}
                        title="Completar restante"
                        type="button"
                      >
                        <Calculator aria-hidden className="size-4" />
                      </button>
                    }
                    type="number"
                    value={line.amount || ""}
                  />
                </div>

                {needsBank(line.method) ? (
                  <VenezuelanBankField
                    onChange={(bankName) => updateLine(line.id, { bankName })}
                    value={line.bankName ?? ""}
                  />
                ) : null}

                {needsPhone(line.method) || needsReference(line.method) ? (
                  <div
                    className={cn(
                      "grid gap-3",
                      needsPhone(line.method) && needsReference(line.method)
                        ? "sm:grid-cols-2"
                        : "grid-cols-1",
                    )}
                  >
                    {needsPhone(line.method) ? (
                      <VenezuelanPhoneField
                        onChange={(phone) => updateLine(line.id, { phone })}
                        value={line.phone ?? ""}
                      />
                    ) : null}

                    {needsReference(line.method) ? (
                      <Input
                        helperText={
                          line.method === "pago_movil"
                            ? "Ultimos 4 digitos de la referencia."
                            : undefined
                        }
                        label="Referencia"
                        onChange={(event) =>
                          updateLine(line.id, { referenceCode: event.target.value })
                        }
                        value={line.referenceCode ?? ""}
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {lines.length < maxLines &&
        pickNextAvailablePaymentMethod(lines, enabledPaymentMethods) ? (
          <Button
            className="w-full gap-2"
            onClick={() => {
              const nextMethod = pickNextAvailablePaymentMethod(
                lines,
                enabledPaymentMethods,
              );
              if (!nextMethod) {
                return;
              }

              setLines((current) => [...current, createEmptyMixedPaymentLine(nextMethod)]);
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            <Plus aria-hidden className="size-4" />
            Agregar metodo
          </Button>
        ) : null}

        {hasSubmitted && !validation.isValid ? (
          <ul className="space-y-1 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {validation.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        ) : null}
      </form>
    </Modal>
  );
}
