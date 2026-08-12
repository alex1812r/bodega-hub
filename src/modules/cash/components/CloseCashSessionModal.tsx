"use client";

import { useEffect, useRef, useState } from "react";

import { useCloseCashSession } from "@/modules/cash/hooks/useCash";
import { Button } from "@/shared/components/Button";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";
import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";

type CloseCashSessionModalProps = {
  accountVes?: number;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  registerName: string;
  sessionId: string;
  theoreticalRef: number;
  theoreticalVes: number;
};

function amountInputValue(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return "";
  }
  return String(value);
}

export function CloseCashSessionModal({
  accountVes = 0,
  onOpenChange,
  open,
  registerName,
  sessionId,
  theoreticalRef,
  theoreticalVes,
}: CloseCashSessionModalProps) {
  const closeSession = useCloseCashSession();
  const [closingVes, setClosingVes] = useState("");
  const [closingRef, setClosingRef] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const didPrefillRef = useRef(false);

  useEffect(() => {
    if (!open) {
      didPrefillRef.current = false;
      return;
    }

    if (didPrefillRef.current) {
      return;
    }

    didPrefillRef.current = true;
    setClosingVes(amountInputValue(theoreticalVes));
    setClosingRef(amountInputValue(theoreticalRef));
  }, [open, theoreticalRef, theoreticalVes]);

  function resetForm() {
    setClosingVes("");
    setClosingRef("");
    setErrorMessage(null);
    didPrefillRef.current = false;
  }

  async function handleSubmit() {
    const ves = Number(closingVes || 0);
    const ref = Number(closingRef || 0);

    if (ves < 0 || ref < 0) {
      setErrorMessage("Los montos de cierre no pueden ser negativos.");
      return;
    }

    try {
      setErrorMessage(null);
      await closeSession.mutateAsync({
        closingRef: ref,
        closingVes: ves,
        sessionId,
      });
      resetForm();
      onOpenChange(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No se pudo cerrar la caja.");
    }
  }

  return (
    <Modal
      description={`Cuenta el efectivo fisico de ${registerName} e indica el monto de cierre.`}
      footer={({ close }) => (
        <>
          <Button
            disabled={closeSession.isPending}
            onClick={() => {
              resetForm();
              close();
            }}
            type="button"
            variant="outline"
          >
            Cancelar
          </Button>
          <Button
            disabled={closeSession.isPending}
            onClick={() => void handleSubmit()}
            type="button"
          >
            {closeSession.isPending ? "Cerrando..." : "Cerrar caja"}
          </Button>
        </>
      )}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          resetForm();
        }
        onOpenChange(nextOpen);
      }}
      open={open}
      title="Cerrar caja"
    >
      <div className="grid gap-3">
        <div className="grid gap-2 rounded-lg border border-border bg-surface-container/40 p-3 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium tracking-wide text-on-surface-variant uppercase">
              Efectivo teorico
            </p>
            <p className="font-semibold tabular-nums">{formatRefUsd(theoreticalRef)}</p>
            <p className="text-sm text-on-surface-variant tabular-nums">
              {formatVesBs(theoreticalVes)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium tracking-wide text-on-surface-variant uppercase">
              Cuenta Bs. (turno)
            </p>
            <p className="font-semibold tabular-nums text-emerald-700">
              {formatVesBs(accountVes)}
            </p>
            <p className="text-xs text-on-surface-variant">
              No se cuenta en el cierre fisico
            </p>
          </div>
        </div>

        <Input
          label="Cierre efectivo Bs."
          min="0"
          onChange={(event) => setClosingVes(event.target.value)}
          step="0.01"
          type="number"
          value={closingVes}
        />
        <Input
          label="Cierre efectivo REF"
          min="0"
          onChange={(event) => setClosingRef(event.target.value)}
          step="0.01"
          type="number"
          value={closingRef}
        />
        {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}
      </div>
    </Modal>
  );
}
