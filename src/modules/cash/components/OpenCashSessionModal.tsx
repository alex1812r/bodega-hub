"use client";

import { useEffect, useRef, useState } from "react";

import {
  useLastUntransferredClosure,
  useOpenCashSession,
} from "@/modules/cash/hooks/useCash";
import { Button } from "@/shared/components/Button";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";

type OpenCashSessionModalProps = {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  registerId: string;
  registerName: string;
};

function amountInputValue(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return "";
  }
  return String(value);
}

export function OpenCashSessionModal({
  onOpenChange,
  open,
  registerId,
  registerName,
}: OpenCashSessionModalProps) {
  const openSession = useOpenCashSession();
  const lastClosure = useLastUntransferredClosure(registerId, open);
  const [openingVes, setOpeningVes] = useState("");
  const [openingRef, setOpeningRef] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [prefilledFromClosure, setPrefilledFromClosure] = useState(false);
  const didPrefillRef = useRef(false);

  useEffect(() => {
    if (!open) {
      didPrefillRef.current = false;
      return;
    }

    if (didPrefillRef.current || lastClosure.isLoading || lastClosure.isFetching) {
      return;
    }

    didPrefillRef.current = true;
    const closure = lastClosure.data;
    if (closure) {
      setOpeningVes(amountInputValue(closure.closingVes));
      setOpeningRef(amountInputValue(closure.closingRef));
      setPrefilledFromClosure(true);
      return;
    }

    setOpeningVes("");
    setOpeningRef("");
    setPrefilledFromClosure(false);
  }, [open, lastClosure.data, lastClosure.isFetching, lastClosure.isLoading]);

  function resetForm() {
    setOpeningVes("");
    setOpeningRef("");
    setErrorMessage(null);
    setPrefilledFromClosure(false);
    didPrefillRef.current = false;
  }

  async function handleSubmit() {
    const ves = Number(openingVes || 0);
    const ref = Number(openingRef || 0);

    if (ves < 0 || ref < 0) {
      setErrorMessage("Los montos de apertura no pueden ser negativos.");
      return;
    }

    try {
      setErrorMessage(null);
      await openSession.mutateAsync({
        openingRef: ref,
        openingVes: ves,
        registerId,
      });
      resetForm();
      onOpenChange(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No se pudo abrir la caja.");
    }
  }

  return (
    <Modal
      description={`Indica el fondo inicial de ${registerName}. Puedes dejar ambos montos en cero.`}
      footer={({ close }) => (
        <>
          <Button
            disabled={openSession.isPending}
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
            disabled={openSession.isPending || lastClosure.isLoading}
            onClick={() => void handleSubmit()}
            type="button"
          >
            {openSession.isPending ? "Abriendo..." : "Abrir caja"}
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
      title="Abrir caja"
    >
      <div className="grid gap-3">
        {prefilledFromClosure ? (
          <p className="text-sm text-muted-foreground">
            Se autocompleto con el ultimo cierre pendiente. Al abrir, ese cierre queda absorbido
            por esta sesion (no se transferira aparte al baul).
          </p>
        ) : null}
        <Input
          label="Apertura Bs."
          min="0"
          onChange={(event) => setOpeningVes(event.target.value)}
          step="0.01"
          type="number"
          value={openingVes}
        />
        <Input
          label="Apertura REF"
          min="0"
          onChange={(event) => setOpeningRef(event.target.value)}
          step="0.01"
          type="number"
          value={openingRef}
        />
        {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}
      </div>
    </Modal>
  );
}
