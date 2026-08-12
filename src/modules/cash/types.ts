export type CashRegister = {
  assignedUserId?: string | null;
  assignedUserName?: string | null;
  createdAt: string;
  id: string;
  isActive: boolean;
  name: string;
  storeId: string;
  updatedAt: string;
};

export type CashSession = {
  absorbedBySessionId?: string | null;
  closedAt?: string | null;
  closingRef?: number | null;
  closingVes?: number | null;
  id: string;
  openedAt: string;
  openingRef: number;
  openingVes: number;
  register: CashRegister;
  registerId: string;
  status: "open" | "closed";
  theoreticalClosingRef?: number | null;
  theoreticalClosingVes?: number | null;
  vaultTransferredAt?: string | null;
};

export type CashMovement = {
  amountRef: number;
  amountVes: number;
  createdAt: string;
  id: string;
  notes?: string | null;
  paymentId?: string | null;
  sessionId: string;
  type: "sale_in" | "transfer_out" | "opening" | "adjustment" | "refund_out" | "account_in" | "account_out";
};
