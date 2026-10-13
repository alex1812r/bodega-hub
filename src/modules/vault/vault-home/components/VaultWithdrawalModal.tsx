"use client";

import { useVaultWithdrawal } from "../../hooks/useVault";

import { VaultCashMovementModal } from "./VaultCashMovementModal";

type VaultWithdrawalModalProps = {
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

export function VaultWithdrawalModal({ onOpenChange, open }: VaultWithdrawalModalProps) {
  const withdrawal = useVaultWithdrawal();

  return (
    <VaultCashMovementModal
      kind="withdrawal"
      mutation={withdrawal}
      onOpenChange={onOpenChange}
      open={open}
    />
  );
}
