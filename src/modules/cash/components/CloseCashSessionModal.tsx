"use client";

import { useEffect, useRef, useState } from "react";

import { useCloseCashSession } from "@/modules/cash/hooks/useCash";
import { Button } from "@/shared/components/Button";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";
import { formatRefUsd, formatVesBs, roundMoney } from "@/shared/utils/currency";

type CloseCashSessionModalProps = {
  accountVes?: number;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  openingRef: number;
  openingVes: number;
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

function MoneyPair({ refAmount, vesAmount }: { refAmount: number; vesAmount: number }) {
  return (
    <>
      <p className="font-semibold tabular-nums">{formatRefUsd(refAmount)}</p>
      <p className="text-sm text-on-surface-variant tabular-nums">{formatVesBs(vesAmount)}</p>
    </>
  );
}

export function CloseCashSessionModal({
  accountVes = 0,
  onOpenChange,
  open,
  openingRef,
  openingVes,
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

  const salesCashRef = roundMoney(theoreticalRef - openingRef);
  const salesCashVes = roundMoney(theoreticalVes - openingVes);

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
      description={`Cuenta TODO el efectivo fisico en ${registerName}: fondo de apertura + efectivo de ventas. El pago movil no se cuenta aqui.`}
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
        <div className="grid gap-3 rounded-lg border border-border bg-surface-container/40 p-3 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium tracking-wide text-on-surface-variant uppercase">
              1. Fondo de apertura
            </p>
            <MoneyPair refAmount={openingRef} vesAmount={openingVes} />
            <p className="mt-1 text-xs text-on-surface-variant">
              Efectivo con el que se abrio la caja
            </p>
          </div>
          <div>
            <p className="text-xs font-medium tracking-wide text-on-surface-variant uppercase">
              2. Efectivo de ventas (turno)
            </p>
            <MoneyPair refAmount={salesCashRef} vesAmount={salesCashVes} />
            <p className="mt-1 text-xs text-on-surface-variant">
              Solo efectivo Bs/USD. Sin pago movil
            </p>
          </div>
          <div className="sm:col-span-2 rounded-md border border-border bg-background/60 p-3">
            <p className="text-xs font-medium tracking-wide text-on-surface-variant uppercase">
              3. Debes contar en el cajon (apertura + ventas)
            </p>
            <MoneyPair refAmount={theoreticalRef} vesAmount={theoreticalVes} />
          </div>
          <div className="sm:col-span-2">
            <p className="text-xs font-medium tracking-wide text-on-surface-variant uppercase">
              Cuenta Bs. del turno (pago movil / transferencia / punto)
            </p>
            <p className="font-semibold tabular-nums text-emerald-700">{formatVesBs(accountVes)}</p>
            <p className="text-xs text-on-surface-variant">
              No entra al cajon ni al cierre fisico
            </p>
          </div>
        </div>

        <p className="text-sm text-on-surface-variant">
          Indica lo que realmente hay en efectivo. Por defecto se prellena con el total del cajon
          (paso 3), no solo con las ventas del dia.
        </p>

        <Input
          label="Efectivo contado Bs. (cajon completo)"
          min="0"
          onChange={(event) => setClosingVes(event.target.value)}
          step="0.01"
          type="number"
          value={closingVes}
        />
        <Input
          label="Efectivo contado REF (cajon completo)"
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
