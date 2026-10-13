"use client";

import { useVaultDeposit } from "../../hooks/useVault";

import { VaultCashMovementModal } from "./VaultCashMovementModal";

type VaultDepositModalProps = {
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

export function VaultDepositModal({ onOpenChange, open }: VaultDepositModalProps) {
  const deposit = useVaultDeposit();

  return (
    <VaultCashMovementModal
      kind="deposit"
      mutation={deposit}
      onOpenChange={onOpenChange}
      open={open}
    />
  );
}
