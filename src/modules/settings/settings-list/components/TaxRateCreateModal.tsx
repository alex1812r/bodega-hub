"use client";

import { type FormEvent, useId, useRef, useState } from "react";

import { FormActions } from "@/shared/components/FormActions";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";
import { NumberInput } from "@/shared/components/NumberInput";
import { formatTaxRatePct } from "@/shared/components/TaxRateChips";
import { useToast } from "@/shared/components/Toast";

import { useCreateTaxRate } from "../../hooks/useTaxRatesAdmin";

const PCT_REQUIRED_MESSAGE = "Escribe el porcentaje de la alícuota.";

type TaxRateCreateModalProps = {
  /** Solo recibe `false`: el modal pide cerrarse (cancelado, Escape o alícuota creada). */
  onOpenChange: (open: boolean) => void;
};

/**
 * Alta de una alícuota de IVA propia de la tienda: etiqueta y porcentaje. Es
 * el único sitio donde se teclea un % de IVA, porque aquí se define la
 * alícuota del catálogo; en el resto de pantallas se elige con `TaxRateChips`.
 *
 * Se monta solo mientras está abierta. Si el servidor rechaza el alta (p. ej.
 * ya existe una con ese nombre), el motivo se muestra aquí y el modal sigue abierto.
 */
export function TaxRateCreateModal({ onOpenChange }: TaxRateCreateModalProps) {
  const formId = useId();
  const { showToast } = useToast();
  const createTaxRate = useCreateTaxRate();
  const [label, setLabel] = useState("");
  const [pct, setPct] = useState<number | null>(null);
  const [showPctRequired, setShowPctRequired] = useState(false);
  // Candado propio: `isPending` llega con el siguiente render, tarde para un
  // segundo Enter o un clic en el mismo tick.
  const isSubmitInFlightRef = useRef(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitInFlightRef.current) {
      return;
    }

    if (pct === null) {
      setShowPctRequired(true);

      return;
    }

    isSubmitInFlightRef.current = true;

    try {
      const rate = await createTaxRate.mutateAsync({ label: label.trim(), pct });

      showToast({
        title: `Alícuota creada: ${rate.label} (${formatTaxRatePct(rate.pct)})`,
        tone: "success",
      });
      onOpenChange(false);
    } catch {
      // El motivo queda en `createTaxRate.error` y se muestra en el formulario.
    } finally {
      isSubmitInFlightRef.current = false;
    }
  }

  return (
    <Modal
      footer={({ close }) => (
        <FormActions
          isSubmitting={createTaxRate.isPending}
          onCancel={close}
          submitFormId={formId}
          submitLabel="Añadir alícuota"
        />
      )}
      onOpenChange={onOpenChange}
      open
      description="Quedará disponible para las categorías y las compras de esta tienda."
      title="Nueva alícuota de IVA"
    >
      <form className="grid gap-4" id={formId} onSubmit={(event) => void handleSubmit(event)}>
        <Input
          label="Etiqueta"
          maxLength={60}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Ej.: Reducida"
          required
          value={label}
        />
        <NumberInput
          decimals={2}
          error={showPctRequired && pct === null ? PCT_REQUIRED_MESSAGE : undefined}
          label="Porcentaje (%)"
          max={100}
          min={0}
          onValueChange={setPct}
          value={pct}
        />
        {createTaxRate.error ? (
          <p className="min-w-0 text-sm text-destructive [overflow-wrap:anywhere]" role="alert">
            {createTaxRate.error.message}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
