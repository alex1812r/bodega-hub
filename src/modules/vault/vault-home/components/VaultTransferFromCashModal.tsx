"use client";

import { useMemo, useState } from "react";

import { usePendingCashClosures } from "@/modules/cash/hooks/useCash";
import type { CashSession } from "@/modules/cash/types";
import { Button } from "@/shared/components/Button";
import { ConfirmActionModal } from "@/shared/components/ConfirmActionModal";
import { Modal } from "@/shared/components/Modal";
import { ProcessGuardModal } from "@/shared/components/ProcessGuard";
import { Textarea } from "@/shared/components/Textarea";
import { useFormModalDiscardGuard } from "@/shared/hooks/useFormModalDiscardGuard";
import { cn } from "@/shared/utils/cn";
import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";

import { useTransferFromCash, useVault } from "../../hooks/useVault";
import { getVaultBalancesState } from "../utils/vaultBalancesState";
import { computeClosuresTransferEffect } from "../utils/vaultEffect";

import { VaultTransferEffects } from "./VaultTransferEffects";

type VaultTransferFromCashModalProps = {
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

/** Sin saldos cargados solo valen los totales del efecto; la confirmación no enseña las cubetas. */
const UNKNOWN_BALANCES = { balanceEfectivoVes: 0, balanceRef: 0, balanceVes: 0 };

function closureLabel(session: CashSession) {
  const closedAt = session.closedAt
    ? new Date(session.closedAt).toLocaleString("es-VE")
    : "sin fecha";
  return `${session.register.name} — cerrado ${closedAt}`;
}

/**
 * Transferencia de cierres de caja al baúl: el formulario no envía, abre la
 * confirmación con los cierres y los saldos resultantes.
 *
 * Con cierres seleccionados o una nota tecleada, cerrar (Esc, clic fuera,
 * Cancelar, la X) o salir de la pantalla pregunta antes con el guardia de
 * proceso; sin nada, o tras transferir, cierra sin preguntar.
 */
export function VaultTransferFromCashModal({
  onOpenChange,
  open,
}: VaultTransferFromCashModalProps) {
  const closures = usePendingCashClosures();
  const transfer = useTransferFromCash();
  const vault = useVault();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const pending = useMemo(() => closures.data ?? [], [closures.data]);
  const selected = useMemo(
    () => pending.filter((session) => selectedIds.includes(session.id)),
    [pending, selectedIds],
  );
  const trimmedNotes = notes.trim();
  const balances = getVaultBalancesState(vault);
  // El "después" suma el CONTADO de cada cierre, que es lo que asienta la RPC.
  const effect = computeClosuresTransferEffect({
    closures: selected,
    vault: balances.vault ?? UNKNOWN_BALANCES,
  });
  const hasTypedData = selectedIds.length > 0 || trimmedNotes !== "";
  // Con la transferencia en vuelo no se pregunta: el cierre ya está bloqueado.
  const { guard, requestClose, trackFocus } = useFormModalDiscardGuard({
    active: open && hasTypedData && !transfer.isPending,
    label:
      selectedIds.length === 0
        ? "Transferencia al baúl sin registrar"
        : `Transferencia de ${
            selectedIds.length === 1 ? "1 cierre" : `${selectedIds.length} cierres`
          } al baúl sin registrar`,
  });

  function resetForm() {
    setSelectedIds([]);
    setNotes("");
    setErrorMessage(null);
    setRequestError(null);
    setConfirmOpen(false);
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
   * incluye el fondo de apertura que el turno siguiente volvió a usar, y
   * transferirlos en bloque re-infla el baúl (docs/cuadre-baul.md §2.2).
   */
  function selectAll() {
    setSelectedIds(
      pending.filter((session) => !session.absorbedBySessionId).map((session) => session.id),
    );
  }

  /** El formulario no envía: abre la confirmación con los cierres y los saldos resultantes. */
  function handleContinue() {
    if (transfer.isPending) {
      return;
    }

    if (selected.length === 0) {
      setErrorMessage("Selecciona al menos un cierre pendiente.");
      return;
    }

    setErrorMessage(null);
    // Un error de un intento anterior no pertenece a esta confirmación.
    setRequestError(null);
    setConfirmOpen(true);
  }

  async function handleConfirm() {
    try {
      await transfer.mutateAsync({
        notes: trimmedNotes || undefined,
        // Solo los cierres que la confirmación enseña: uno que ya no esté pendiente no viaja.
        sessionIds: selected.map((session) => session.id),
      });
    } catch (error) {
      setRequestError(
        error instanceof Error ? error.message : "No se pudo transferir desde la caja.",
      );
      return;
    }

    resetForm();
    onOpenChange(false);
  }

  return (
    <Modal
      description="Transfiere al baúl cierres pendientes. Si una caja se reabrió sin transferir, el cierre anterior ya quedó absorbido y solo verás el cierre vigente."
      footer={({ close }) => (
        <>
          <Button disabled={transfer.isPending} onClick={close} type="button" variant="outline">
            Cancelar
          </Button>
          <Button disabled={transfer.isPending} onClick={handleContinue} type="button">
            Continuar
          </Button>
        </>
      )}
      onOpenChange={(nextOpen) => {
        // Con la transferencia en vuelo el modal no se cierra: su resultado llegaría sin formulario.
        if (!nextOpen && transfer.isPending) {
          return;
        }

        if (nextOpen) {
          onOpenChange(true);
          return;
        }

        // Con cierres seleccionados o una nota pregunta antes de descartarlos.
        requestClose(() => {
          resetForm();
          onOpenChange(false);
        });
      }}
      open={open}
      title="Transferir cierres al baúl"
    >
      <div className="grid gap-3" onFocus={trackFocus}>
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
                          se recicló en el turno siguiente. Revísalo antes de transferirlo.
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
              {formatRefUsd(effect.totalRef)}
            </span>
            {" · "}
            <span className="font-medium text-foreground tabular-nums">
              {formatVesBs(effect.totalVes)}
            </span>
          </p>
        ) : null}

        <Textarea
          label="Nota (opcional)"
          onChange={(event) => setNotes(event.target.value)}
          rows={3}
          value={notes}
        />
        {errorMessage ? (
          <p className="text-sm text-destructive" role="alert">
            {errorMessage}
          </p>
        ) : null}
        {/* Con la confirmación abierta el error se dice en ella; al cancelarla sigue a la vista aquí. */}
        {requestError && !confirmOpen ? (
          <p className="text-sm text-destructive" role="alert">
            {requestError}
          </p>
        ) : null}
      </div>
      <ConfirmActionModal
        confirmLabel="Transferir cierres"
        description="Revisa los cierres y cómo quedan los saldos del baúl antes de transferir."
        error={requestError}
        isPending={transfer.isPending}
        onConfirm={handleConfirm}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setConfirmOpen(false);
          }
        }}
        onRetry={() => void vault.refetch()}
        // La pregunta del guardia (ATRÁS del navegador) no se apila sobre la confirmación.
        open={confirmOpen && !guard.dialog.open}
        renderEffects={() => <VaultTransferEffects effect={effect} />}
        status={balances.status}
        statusHint={balances.status === "error" ? "No se ha transferido nada." : undefined}
        statusMessage={balances.statusMessage}
        title="Confirmar transferencia al baúl"
      >
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
          <dt>Nota</dt>
          <dd className="whitespace-pre-wrap break-words font-medium text-foreground">
            {trimmedNotes || "Sin nota"}
          </dd>
        </dl>
      </ConfirmActionModal>
      <ProcessGuardModal guard={guard} />
    </Modal>
  );
}
