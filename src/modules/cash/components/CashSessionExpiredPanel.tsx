"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { Button } from "@/shared/components/Button";
import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";

import { cashMovementsQuery, useCloseCashSession } from "../hooks/useCash";

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
  const queryClient = useQueryClient();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [readingTotals, setReadingTotals] = useState(false);
  const busy = readingTotals || closeSession.isPending;
  // Cerrojo síncrono: `isPending` llega un render tarde y un doble clic enviaba dos
  // cierres (200 + 400). Solo se suelta si el cierre falla, para poder reintentar.
  const lockedRef = useRef(false);

  async function handleClose() {
    if (lockedRef.current) {
      return;
    }

    lockedRef.current = true;

    try {
      setErrorMessage(null);
      setReadingTotals(true);
      // El cierre asienta lo que se le envía: el teórico se lee del servidor en este momento,
      // no de la caché (que puede ser anterior a la última venta). Si no se puede leer, no cierra.
      const totals = await queryClient
        .fetchQuery({ ...cashMovementsQuery(sessionId), staleTime: 0 })
        .finally(() => setReadingTotals(false));

      await closeSession.mutateAsync({
        closingRef: totals.theoretical.ref,
        closingVes: totals.theoretical.ves,
        sessionId,
      });
    } catch (error) {
      lockedRef.current = false;
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
      <Button disabled={busy} onClick={() => void handleClose()} size="lg" type="button">
        {busy ? "Cerrando..." : "Cerrar con teórico y continuar"}
      </Button>
      {errorMessage ? (
        <p className="text-sm text-destructive" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
