"use client";

import { type FormEvent, useId, useState } from "react";

import { FormActions } from "@/shared/components/FormActions";
import { Modal } from "@/shared/components/Modal";
import { Textarea } from "@/shared/components/Textarea";
import { formatRefUsd } from "@/shared/utils/currency";

import { useCancelPayrollPayment } from "../../hooks/usePayroll";
import type { PayrollItem } from "../../types";

type PayrollCancelPaymentModalProps = {
  /** El recibo pagado que se va a anular. `null` cierra el modal. */
  item: PayrollItem | null;
  onOpenChange: (open: boolean) => void;
};

/**
 * Anular un pago devuelve dinero al baul, asi que la API exige un motivo
 * (`PT400` si llega vacio). Queda en las notas de la quincena.
 */
export function PayrollCancelPaymentModal({
  item,
  onOpenChange,
}: PayrollCancelPaymentModalProps) {
  const cancelPayment = useCancelPayrollPayment();
  const notesId = useId();
  const [notes, setNotes] = useState("");
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedNotes = notes.trim();
  const notesError = hasSubmitted && trimmedNotes.length === 0 ? "Explica por que se anula" : null;

  function close() {
    setNotes("");
    setHasSubmitted(false);
    setError(null);
    onOpenChange(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHasSubmitted(true);
    setError(null);

    if (!item || trimmedNotes.length === 0) {
      return;
    }

    try {
      await cancelPayment.mutateAsync({ itemId: item.id, notes: trimmedNotes });
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo anular el pago.");
    }
  }

  return (
    <Modal
      description="El dinero vuelve al baul y el recibo queda pendiente de nuevo."
      onOpenChange={(open) => {
        if (!open) {
          close();
        }
      }}
      open={item !== null}
      title="Anular pago de nomina"
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        {item ? (
          <p className="text-sm text-muted-foreground">
            Se anulara el pago de <span className="font-medium text-foreground">{item.fullName}</span>{" "}
            por {formatRefUsd(item.totalRef)}.
          </p>
        ) : null}

        <Textarea
          error={notesError ?? undefined}
          id={notesId}
          label="Motivo"
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Por ejemplo: se pago con el metodo equivocado"
          required
          rows={3}
          value={notes}
        />

        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <FormActions
          isSubmitting={cancelPayment.isPending}
          onCancel={close}
          submitLabel="Anular pago"
        />
      </form>
    </Modal>
  );
}
