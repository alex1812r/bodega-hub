export type StoreVault = {
  /** Efectivo físico en Bs. */
  balanceEfectivoVes: number;
  balanceRef: number;
  /** Saldo de cuenta (PM / transferencia / punto) en Bs. */
  balanceVes: number;
  createdAt: string;
  id: string;
  storeId: string;
  updatedAt: string;
};

export type VaultMovementBucket = "efectivo" | "cuenta";

export type VaultMovement = {
  amountRef: number;
  amountVes: number;
  bucket: VaultMovementBucket;
  createdAt: string;
  fromSessionId?: string | null;
  id: string;
  notes?: string | null;
  paymentId?: string | null;
  /** Recibo de nómina que originó el movimiento (`payroll_out`). */
  payrollItemId?: string | null;
  type:
    | "transfer_in"
    | "purchase_out"
    | "deposit"
    | "withdrawal"
    | "adjustment"
    | "sale_in"
    | "payroll_out";
  vaultId: string;
};
