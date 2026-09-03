"use client";

import { useMemo, useState } from "react";

import { usePendingCashClosures } from "@/modules/cash/hooks/useCash";
import type { CashSession } from "@/modules/cash/types";
import { Button } from "@/shared/components/Button";
import { Modal } from "@/shared/components/Modal";
import { Textarea } from "@/shared/components/Textarea";
import { cn } from "@/shared/utils/cn";
import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";

import { useTransferFromCash } from "../../hooks/useVault";

type VaultTransferFromCashModalProps = {
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

function closureLabel(session: CashSession) {
  const closedAt = session.closedAt
    ? new Date(session.closedAt).toLocaleString("es-VE")
    : "sin fecha";
  return `${session.register.name} — cerrado ${closedAt}`;
}

export function VaultTransferFromCashModal({
  onOpenChange,
  open,
}: VaultTransferFromCashModalProps) {
  const closures = usePendingCashClosures();
  const transfer = useTransferFromCash();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pending = closures.data ?? [];
  const selected = useMemo(
    () => pending.filter((session) => selectedIds.includes(session.id)),
    [pending, selectedIds],
  );
  const selectedTotals = useMemo(
    () =>
      selected.reduce(
        (total, session) => {
          total.ref += session.closingRef ?? 0;
          total.ves += session.closingVes ?? 0;
          return total;
        },
        { ref: 0, ves: 0 },
      ),
    [selected],
  );

  function resetForm() {
    setSelectedIds([]);
    setNotes("");
    setErrorMessage(null);
  }

  function toggleSession(sessionId: string) {
    setSelectedIds((current) =>
      current.includes(sessionId)
        ? current.filter((id) => id !== sessionId)
        : [...current, sessionId],
    );
  }

  /**
   * Deja fuera los cierres absorbidos: son anteriores a `20260904b`, su monto
   * incluye el fondo de apertura que el turno siguiente volvio a usar, y
   * transferirlos en bloque re-infla el baul (docs/cuadre-baul.md §2.2).
   */
  function selectAll() {
    setSelectedIds(
      pending.filter((session) => !session.absorbedBySessionId).map((session) => session.id),
    );
  }

  async function handleSubmit() {
    if (selectedIds.length === 0) {
      setErrorMessage("Selecciona al menos un cierre pendiente.");
      return;
    }

    try {
      setErrorMessage(null);
      await transfer.mutateAsync({
        notes: notes.trim() || undefined,
        sessionIds: selectedIds,
      });
      resetForm();
      onOpenChange(false);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "No se pudo transferir desde la caja.",
      );
    }
  }

  return (
    <Modal
      description="Transfiere al baúl cierres pendientes. Si una caja se reabrió sin transferir, el cierre anterior ya quedó absorbido y solo verás el cierre vigente."
      footer={({ close }) => (
        <>
          <Button
            disabled={transfer.isPending}
            onClick={() => {
              resetForm();
              close();
            }}
            type="button"
            variant="outline"
          >
            Cancelar
          </Button>
          <Button disabled={transfer.isPending} onClick={() => void handleSubmit()} type="button">
            {transfer.isPending ? "Transferiendo..." : "Transferir cierres"}
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
      title="Transferir cierres al baúl"
    >
      <div className="grid gap-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-foreground">Cierres pendientes</p>
          <Button
            disabled={pending.length === 0 || closures.isLoading}
            onClick={selectAll}
            size="sm"
            type="button"
            variant="secondary"
          >
            Seleccionar todos
          </Button>
        </div>

        {closures.isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando cierres...</p>
        ) : pending.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
            No hay cierres pendientes por transferir.
          </p>
        ) : (
          <ul className="max-h-64 space-y-2 overflow-y-auto">
            {pending.map((session) => {
              const checked = selectedIds.includes(session.id);
              return (
                <li key={session.id}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                      checked
                        ? "border-primary/40 bg-primary/5"
                        : "border-border bg-surface-container-lowest hover:bg-surface-container-low",
                    )}
                  >
                    <input
                      checked={checked}
                      className="mt-1 h-4 w-4 accent-primary"
                      onChange={() => toggleSession(session.id)}
                      type="checkbox"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-foreground">
                        {closureLabel(session)}
                      </span>
                      <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm tabular-nums text-on-surface-variant">
                        <span>{formatRefUsd(session.closingRef ?? 0)}</span>
                        <span>{formatVesBs(session.closingVes ?? 0)}</span>
                      </span>
                      {session.absorbedBySessionId ? (
                        <span className="mt-1 block text-xs text-amber-700 dark:text-amber-300">
                          Cierre anterior al cambio de apertura: el monto incluye el fondo, que
                          se reciclo en el turno siguiente. Revisalo antes de transferirlo.
                        </span>
                      ) : null}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        {selected.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            Total seleccionado:{" "}
            <span className="font-medium text-foreground tabular-nums">
              {formatRefUsd(selectedTotals.ref)}
            </span>
            {" · "}
            <span className="font-medium text-foreground tabular-nums">
              {formatVesBs(selectedTotals.ves)}
            </span>
          </p>
        ) : null}

        <Textarea
          label="Nota (opcional)"
          onChange={(event) => setNotes(event.target.value)}
          rows={3}
          value={notes}
        />
        {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}
      </div>
    </Modal>
  );
}
