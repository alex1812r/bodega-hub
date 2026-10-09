"use client";

import { useState } from "react";

import { Button } from "@/shared/components/Button";
import {
  ConfirmActionModal,
  type ConfirmActionStatus,
} from "@/shared/components/ConfirmActionModal";
import { Modal } from "@/shared/components/Modal";
import { NumberInput } from "@/shared/components/NumberInput";
import { Textarea } from "@/shared/components/Textarea";

import { useVault } from "../../hooks/useVault";
import { getVaultBalancesState } from "../utils/vaultBalancesState";
import {
  buildVaultBucketConfirmEffects,
  computeVaultCashMovementEffect,
  formatVaultAmount,
  type VaultCashMovementKind,
} from "../utils/vaultEffect";

type VaultCashMovementInput = { amountRef: number; amountVes: number; notes?: string };

type VaultCashMovementModalProps = {
  kind: VaultCashMovementKind;
  mutation: {
    isPending: boolean;
    mutateAsync: (input: VaultCashMovementInput) => Promise<unknown>;
  };
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

const copy: Record<
  VaultCashMovementKind,
  {
    amountLabel: string;
    confirmDescription: string;
    confirmTitle: string;
    description: string;
    fallbackError: string;
    title: string;
  }
> = {
  deposit: {
    amountLabel: "Depósito",
    confirmDescription: "Revisa cómo quedan los saldos del baúl antes de registrar el depósito.",
    confirmTitle: "Confirmar depósito al baúl",
    description: "Ingresa efectivo físico al baúl (Bs. y/o REF). No afecta el saldo de cuenta.",
    fallbackError: "No se pudo registrar el depósito.",
    title: "Depositar efectivo",
  },
  withdrawal: {
    amountLabel: "Retiro",
    confirmDescription: "Revisa cómo quedan los saldos del baúl antes de registrar el retiro.",
    confirmTitle: "Confirmar retiro del baúl",
    description:
      "Saca efectivo físico del baúl. No puede superar el saldo de efectivo disponible.",
    fallbackError: "No se pudo registrar el retiro.",
    title: "Retirar efectivo",
  },
};

const INSUFFICIENT_MESSAGE = "El retiro supera el efectivo disponible en el baúl.";

/**
 * Depósito o retiro de efectivo del baúl: el formulario no envía, abre la
 * confirmación con el saldo actual → resultante de cada cubeta.
 */
export function VaultCashMovementModal({
  kind,
  mutation,
  onOpenChange,
  open,
}: VaultCashMovementModalProps) {
  const vault = useVault();
  const [amountVes, setAmountVes] = useState("");
  const [amountRef, setAmountRef] = useState("");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const text = copy[kind];
  const ves = Number(amountVes || 0);
  const ref = Number(amountRef || 0);
  const trimmedNotes = notes.trim();
  const balances = getVaultBalancesState(vault);
  const effect = balances.vault
    ? computeVaultCashMovementEffect({ amountRef: ref, amountVes: ves, kind, vault: balances.vault })
    : null;
  // El servidor rechaza el retiro entero si un monto supera su saldo: se frena aquí.
  const insufficientVes = Boolean(effect?.insufficient.ves);
  const insufficientRef = Boolean(effect?.insufficient.ref);
  const isInsufficient = insufficientVes || insufficientRef;
  // Los saldos pueden llegar con la confirmación ya abierta: tampoco entonces se confirma un retiro imposible.
  const confirmStatus: ConfirmActionStatus = isInsufficient ? "blocked" : balances.status;
  const confirmStatusMessage = isInsufficient ? INSUFFICIENT_MESSAGE : balances.statusMessage;
  const amountSummary = [
    ves > 0 ? formatVaultAmount("ves", ves) : null,
    ref > 0 ? formatVaultAmount("ref", ref) : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");

  function resetForm() {
    setAmountVes("");
    setAmountRef("");
    setNotes("");
    setFormError(null);
    setRequestError(null);
    setConfirmOpen(false);
  }

  function handleContinue() {
    if (mutation.isPending) {
      return;
    }

    if (ves < 0 || ref < 0 || (ves <= 0 && ref <= 0)) {
      setFormError("Indica al menos un monto mayor a cero.");
      return;
    }

    if (isInsufficient) {
      setFormError(INSUFFICIENT_MESSAGE);
      return;
    }

    setFormError(null);
    // Un error de un intento anterior no pertenece a esta confirmación.
    setRequestError(null);
    setConfirmOpen(true);
  }

  async function handleConfirm() {
    try {
      await mutation.mutateAsync({
        amountRef: ref,
        amountVes: ves,
        notes: trimmedNotes || undefined,
      });
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : text.fallbackError);
      return;
    }

    resetForm();
    onOpenChange(false);
  }

  return (
    <Modal
      description={text.description}
      footer={({ close }) => (
        <>
          <Button disabled={mutation.isPending} onClick={close} type="button" variant="outline">
            Cancelar
          </Button>
          <Button
            disabled={mutation.isPending}
            onClick={handleContinue}
            type="button"
            variant={kind === "withdrawal" ? "danger" : "primary"}
          >
            Continuar
          </Button>
        </>
      )}
      onOpenChange={(nextOpen) => {
        // Con la operación en vuelo el modal no se cierra: su resultado llegaría sin formulario.
        if (!nextOpen && mutation.isPending) {
          return;
        }

        if (!nextOpen) {
          resetForm();
        }

        onOpenChange(nextOpen);
      }}
      open={open}
      title={text.title}
    >
      <div className="grid gap-3">
        <NumberInput
          decimals={2}
          error={
            insufficientVes && balances.vault
              ? `Supera el efectivo disponible: ${formatVaultAmount("ves", balances.vault.balanceEfectivoVes)}.`
              : undefined
          }
          label="Monto Bs."
          onChange={(event) => setAmountVes(event.target.value)}
          value={amountVes}
        />
        <NumberInput
          decimals={2}
          error={
            insufficientRef && balances.vault
              ? `Supera el efectivo disponible: ${formatVaultAmount("ref", balances.vault.balanceRef)}.`
              : undefined
          }
          label="Monto REF"
          onChange={(event) => setAmountRef(event.target.value)}
          value={amountRef}
        />
        <Textarea
          label="Nota (opcional)"
          onChange={(event) => setNotes(event.target.value)}
          rows={3}
          value={notes}
        />
        {formError ? (
          <p className="text-sm text-destructive" role="alert">
            {formError}
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
        confirmLabel={text.title}
        description={text.confirmDescription}
        effects={effect ? buildVaultBucketConfirmEffects(effect.buckets) : undefined}
        error={requestError}
        isPending={mutation.isPending}
        onConfirm={handleConfirm}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setConfirmOpen(false);
          }
        }}
        onRetry={() => void vault.refetch()}
        open={confirmOpen}
        status={confirmStatus}
        statusHint={confirmStatus === "loading" ? undefined : "No se ha registrado nada."}
        statusMessage={confirmStatusMessage}
        title={text.confirmTitle}
        variant={kind === "withdrawal" ? "danger" : "default"}
      >
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
          <dt>{text.amountLabel}</dt>
          <dd className="font-medium tabular-nums text-foreground">{amountSummary}</dd>
          <dt>Nota</dt>
          <dd className="whitespace-pre-wrap break-words font-medium text-foreground">
            {trimmedNotes || "Sin nota"}
          </dd>
        </dl>
      </ConfirmActionModal>
    </Modal>
  );
}
