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

export type CashSessionClosedReason = "manual" | "end_of_day" | "max_24h";

/** Saldos vivos de un turno abierto (lo que hay en la caja antes de cerrarla). */
export type CashSessionLiveTotals = {
  /** Bs. cobrados en cuenta durante el turno: pago movil, transferencia y punto. */
  accountVes: number;
  /** USD fisicos en el cajon: fondo de apertura + ventas en efectivo. */
  cashRef: number;
  /** Bs. fisicos en el cajon: fondo de apertura + ventas en efectivo. */
  cashVes: number;
};

export type CashSession = {
  absorbedBySessionId?: string | null;
  closedAt?: string | null;
  closedReason?: CashSessionClosedReason | null;
  closingRef?: number | null;
  closingVes?: number | null;
  id: string;
  /** Solo en turnos abiertos: saldos acumulados hasta ahora. */
  liveTotals?: CashSessionLiveTotals | null;
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
  type:
    | "sale_in"
    | "transfer_out"
    | "opening"
    | "adjustment"
    | "refund_out"
    | "account_in"
    | "account_out"
    /** Vuelto entregado en efectivo por el excedente de un cobro. */
    | "change_out";
};
