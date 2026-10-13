"use client";

import { type FormEvent, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { FormActions } from "@/shared/components/FormActions";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";
import { NumberInput } from "@/shared/components/NumberInput";
import { formatTaxRatePct } from "@/shared/components/TaxRateChips";
import { useToast } from "@/shared/components/Toast";
import { useTaxRates } from "@/shared/hooks/useTaxRates";

import { useCreateTaxRate } from "../../hooks/useTaxRatesAdmin";

const LABEL_REQUIRED_MESSAGE = "Escribe la etiqueta de la alícuota.";
const PCT_REQUIRED_MESSAGE = "Escribe el porcentaje de la alícuota.";
const PCT_MAX = 100;
const PCT_RANGE_MESSAGE = `El porcentaje debe estar entre 0 y ${PCT_MAX}.`;

type TaxRateCreateModalProps = {
  /** Solo recibe `false`: el modal pide cerrarse (cancelado, Escape o alícuota creada). */
  onOpenChange: (open: boolean) => void;
};

/**
 * Alta de una alícuota de IVA propia de la tienda: etiqueta y porcentaje. Es
 * el único sitio donde se teclea un % de IVA, porque aquí se define la
 * alícuota del catálogo; en el resto de pantallas se elige con `TaxRateChips`.
 *
 * Etiqueta y porcentaje son obligatorios: vacíos, cada campo muestra su aviso
 * y el primero recibe el foco. Un porcentaje que ya tiene otra alícuota activa
 * se avisa, pero no impide añadirla.
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
  // Tras intentar enviar: los campos vacíos muestran su aviso.
  const [showRequired, setShowRequired] = useState(false);
  // El catálogo ya lo tiene en caché la sección que abre este modal.
  const { rates } = useTaxRates({ activeOnly: false });
  // Candado propio: `isPending` llega con el siguiente render, tarde para un
  // segundo Enter o un clic en el mismo tick.
  const isSubmitInFlightRef = useRef(false);
  // Sin `max` en el campo: recortaría 150 a 100 al salir, sin avisar.
  const isPctOutOfRange = pct !== null && pct > PCT_MAX;
  const isLabelMissing = !label.trim();
  const sameActivePct =
    pct === null
      ? undefined
      : rates.find((rate) => rate.isActive && Math.abs(rate.pct - pct) < 0.0001);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitInFlightRef.current) {
      return;
    }

    if (isLabelMissing || pct === null || isPctOutOfRange) {
      const form = event.currentTarget;

      flushSync(() => setShowRequired(true));
      form.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus();

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
          error={showRequired && isLabelMissing ? LABEL_REQUIRED_MESSAGE : undefined}
          label="Etiqueta"
          maxLength={60}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Ej.: Reducida"
          value={label}
        />
        <NumberInput
          decimals={2}
          error={
            isPctOutOfRange
              ? PCT_RANGE_MESSAGE
              : showRequired && pct === null
                ? PCT_REQUIRED_MESSAGE
                : undefined
          }
          label="Porcentaje (%)"
          min={0}
          onValueChange={setPct}
          value={pct}
        />
        {sameActivePct ? (
          <p className="min-w-0 text-sm text-on-surface-variant [overflow-wrap:anywhere]" role="status">
            Ya hay una alícuota activa con ese porcentaje: {sameActivePct.label} (
            {formatTaxRatePct(sameActivePct.pct)}). Puedes añadirla igual.
          </p>
        ) : null}
        {createTaxRate.error ? (
          <p className="min-w-0 text-sm text-destructive [overflow-wrap:anywhere]" role="alert">
            {createTaxRate.error.message}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
