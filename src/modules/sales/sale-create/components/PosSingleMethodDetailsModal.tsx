"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { FormActions } from "@/shared/components/FormActions";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";
import { VenezuelanBankField } from "@/shared/components/VenezuelanBankField";
import { VenezuelanPhoneField } from "@/shared/components/VenezuelanPhoneField";
import type { PaymentMethod } from "@/shared/mocks/erp-data";
import { cn } from "@/shared/utils/cn";

import {
  createEmptySinglePaymentDetails,
  needsPhone,
  validateSinglePaymentDetails,
  type PosSinglePaymentDetails,
} from "../utils/mixedPayments";
import { posPaymentMethodLabels } from "./PosPaymentMethods";

type PosSingleMethodDetailsModalProps = {
  initialDetails?: PosSinglePaymentDetails | null;
  method: PaymentMethod | null;
  onCancel: () => void;
  onConfirm: (details: PosSinglePaymentDetails) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

export function PosSingleMethodDetailsModal({
  initialDetails,
  method,
  onCancel,
  onConfirm,
  onOpenChange,
  open,
}: PosSingleMethodDetailsModalProps) {
  const formId = useId();
  const confirmedRef = useRef(false);
  const [details, setDetails] = useState<PosSinglePaymentDetails>(
    createEmptySinglePaymentDetails,
  );
  const [hasSubmitted, setHasSubmitted] = useState(false);

  useEffect(() => {
    if (!open || !method) {
      return;
    }

    confirmedRef.current = false;
    setHasSubmitted(false);
    setDetails(
      initialDetails
        ? { ...initialDetails }
        : createEmptySinglePaymentDetails(),
    );
  }, [initialDetails, method, open]);

  const validation = useMemo(
    () =>
      method
        ? validateSinglePaymentDetails(method, details)
        : { errors: ["Metodo invalido."], isValid: false },
    [details, method],
  );

  if (!method) {
    return null;
  }

  function handleConfirm() {
    setHasSubmitted(true);
    if (!validation.isValid) {
      return;
    }

    confirmedRef.current = true;
    onConfirm({
      bankName: details.bankName.trim(),
      phone: details.phone.trim(),
      referenceCode: details.referenceCode.trim(),
    });
    // Close via Modal onOpenChange so the click-through guard runs.
    onOpenChange(false);
  }

  function handleDismiss() {
    if (confirmedRef.current) {
      confirmedRef.current = false;
      return;
    }

    onCancel();
  }

  return (
    <Modal
      description={`Completa los datos de ${posPaymentMethodLabels[method]} para poder procesar la venta.`}
      footer={({ close }) => (
        <FormActions
          cancelLabel="Cancelar"
          onCancel={close}
          submitFormId={formId}
          submitLabel="Aplicar"
        />
      )}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          handleDismiss();
        }
        onOpenChange(nextOpen);
      }}
      open={open}
      title={`Datos de ${posPaymentMethodLabels[method]}`}
    >
      <form
        className="space-y-4"
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          handleConfirm();
        }}
      >
        <VenezuelanBankField
          error={
            hasSubmitted && validation.errors.some((error) => error.toLowerCase().includes("banco"))
              ? validation.errors.find((error) => error.toLowerCase().includes("banco"))
              : undefined
          }
          onChange={(bankName) => setDetails((current) => ({ ...current, bankName }))}
          value={details.bankName}
        />

        <div
          className={cn(
            "grid gap-3",
            needsPhone(method) ? "sm:grid-cols-2" : "grid-cols-1",
          )}
        >
          {needsPhone(method) ? (
            <VenezuelanPhoneField
              error={
                hasSubmitted &&
                validation.errors.some((error) => error.toLowerCase().includes("telefono"))
                  ? validation.errors.find((error) =>
                      error.toLowerCase().includes("telefono"),
                    )
                  : undefined
              }
              onChange={(phone) => setDetails((current) => ({ ...current, phone }))}
              value={details.phone}
            />
          ) : null}

          <Input
            error={
              hasSubmitted &&
              validation.errors.some(
                (error) =>
                  error.toLowerCase().includes("referencia") ||
                  error.toLowerCase().includes("transferencia"),
              )
                ? validation.errors.find(
                    (error) =>
                      error.toLowerCase().includes("referencia") ||
                      error.toLowerCase().includes("transferencia"),
                  )
                : undefined
            }
            helperText={
              method === "pago_movil"
                ? "Ultimos 4 digitos de la referencia."
                : "Numero de transferencia."
            }
            label="Referencia"
            onChange={(event) =>
              setDetails((current) => ({
                ...current,
                referenceCode: event.target.value,
              }))
            }
            value={details.referenceCode}
          />
        </div>

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
