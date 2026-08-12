export type StoreVault = {
  balanceRef: number;
  balanceVes: number;
  createdAt: string;
  id: string;
  storeId: string;
  updatedAt: string;
};

export type VaultMovement = {
  amountRef: number;
  amountVes: number;
  createdAt: string;
  fromSessionId?: string | null;
  id: string;
  notes?: string | null;
  paymentId?: string | null;
  type: "transfer_in" | "purchase_out" | "deposit" | "withdrawal" | "adjustment";
  vaultId: string;
};
