"use client";

import { useState } from "react";

import { Button } from "@/shared/components/Button";
import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";

import { useCloseCashSession } from "../hooks/useCash";

type CashSessionExpiredPanelProps = {
  registerName: string;
  sessionId: string;
  theoreticalRef: number;
  theoreticalVes: number;
};

export function CashSessionExpiredPanel({
  registerName,
  sessionId,
  theoreticalRef,
  theoreticalVes,
}: CashSessionExpiredPanelProps) {
  const closeSession = useCloseCashSession();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleClose() {
    try {
      setErrorMessage(null);
      await closeSession.mutateAsync({
        closingRef: theoreticalRef,
        closingVes: theoreticalVes,
        sessionId,
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No se pudo cerrar la caja.");
    }
  }

  return (
    <div className="flex max-w-md flex-col items-center gap-3 text-center">
      <h2 className="text-lg font-semibold text-foreground">La jornada de caja venció</h2>
      <p className="text-sm text-on-surface-variant">
        {registerName} superó el tope (medianoche Caracas o 24 h). Se cerrará con el efectivo teórico.
        Luego puedes abrir un nuevo turno.
      </p>
      <p className="text-sm tabular-nums text-foreground">
        {formatRefUsd(theoreticalRef)} · {formatVesBs(theoreticalVes)}
      </p>
      <Button disabled={closeSession.isPending} onClick={() => void handleClose()} size="lg" type="button">
        {closeSession.isPending ? "Cerrando..." : "Cerrar con teórico y continuar"}
      </Button>
      {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}
    </div>
  );
}
