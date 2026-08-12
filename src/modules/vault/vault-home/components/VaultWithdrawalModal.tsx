"use client";

import { useState } from "react";

import { Button } from "@/shared/components/Button";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";
import { Textarea } from "@/shared/components/Textarea";

import { useVaultWithdrawal } from "../../hooks/useVault";

type VaultWithdrawalModalProps = {
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

export function VaultWithdrawalModal({ onOpenChange, open }: VaultWithdrawalModalProps) {
  const withdrawal = useVaultWithdrawal();
  const [amountVes, setAmountVes] = useState("");
  const [amountRef, setAmountRef] = useState("");
  const [notes, setNotes] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function resetForm() {
    setAmountVes("");
    setAmountRef("");
    setNotes("");
    setErrorMessage(null);
  }

  async function handleSubmit() {
    const ves = Number(amountVes || 0);
    const ref = Number(amountRef || 0);

    if (ves < 0 || ref < 0 || (ves <= 0 && ref <= 0)) {
      setErrorMessage("Indica al menos un monto mayor a cero.");
      return;
    }

    try {
      setErrorMessage(null);
      await withdrawal.mutateAsync({
        amountRef: ref,
        amountVes: ves,
        notes: notes.trim() || undefined,
      });
      resetForm();
      onOpenChange(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No se pudo registrar el retiro.");
    }
  }

  return (
    <Modal
      description="Saca efectivo fisico del baul. No puede superar el saldo de efectivo disponible."
      footer={({ close }) => (
        <>
          <Button
            disabled={withdrawal.isPending}
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
            disabled={withdrawal.isPending}
            onClick={() => void handleSubmit()}
            type="button"
            variant="danger"
          >
            {withdrawal.isPending ? "Guardando..." : "Retirar efectivo"}
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
      title="Retirar efectivo"
    >
      <div className="grid gap-3">
        <Input
          label="Monto Bs."
          min="0"
          onChange={(event) => setAmountVes(event.target.value)}
          step="0.01"
          type="number"
          value={amountVes}
        />
        <Input
          label="Monto REF"
          min="0"
          onChange={(event) => setAmountRef(event.target.value)}
          step="0.01"
          type="number"
          value={amountRef}
        />
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
