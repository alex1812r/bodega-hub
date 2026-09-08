import { type PaymentMethod, type UserRole } from "@bodega/core";

import { type PayrollCommissionKind } from "./utils/payrollMath";

export type { PayrollCommissionKind };

/** `payment_currency` de la base: la moneda en la que se le entregó el dinero al cajero. */
export type PayrollPaidCurrency = "USD" | "VES";

export type PayrollPeriodStatus = "borrador" | "aprobado" | "pagado";

export type PayrollItemStatus = "pendiente" | "pagado";

export type PayrollSettings = {
  defaultCommissionPct: number;
  eligibleRoles: UserRole[];
  reinvestPct: number;
  reservePct: number;
  storeId: string;
  updatedAt: string;
  warnShareOfGrossProfitPct: number;
};

/** Perfil elegible de la tienda con su configuración de comisión, si ya la tiene. */
export type PayrollEmployee = {
  commissionPct: number;
  /** `null` mientras el admin no haya guardado un porcentaje para este perfil. */
  employeeId: string | null;
  fullName: string;
  isActive: boolean;
  profileId: string;
  role: UserRole;
};

export type PayrollCommissionSale = {
  commissionRef: number;
  createdAt: string;
  id: string;
  /** Número visible de la venta (`sales.invoice_number`). */
  invoiceNumber: string | null;
  kind: PayrollCommissionKind;
  saleId: string;
  /** Fecha de la venta, para auditar la quincena a la que pertenece. */
  saleCreatedAt: string;
  saleTotalRef: number;
};

export type PayrollItem = {
  commissionPct: number;
  commissionRef: number;
  employeeId: string;
  fullName: string;
  id: string;
  paidAmount: number | null;
  paidAt: string | null;
  paidBy: string | null;
  paidCurrency: PayrollPaidCurrency | null;
  paidMethod: PaymentMethod | null;
  paidRateVes: number | null;
  paidRef: number | null;
  paidReference: string | null;
  paidVes: number | null;
  periodId: string;
  profileId: string;
  reversalRef: number;
  salesCount: number;
  salesRef: number;
  status: PayrollItemStatus;
  storeId: string;
  totalRef: number;
  vaultMovementId: string | null;
};

export type PayrollPeriod = {
  approvedAt: string | null;
  approvedBy: string | null;
  commissionRef: number;
  createdAt: string;
  fromDate: string;
  /** Informativo: alimenta el semáforo. `null` si el reporte de margen falló. */
  grossProfitRef: number | null;
  id: string;
  notes: string | null;
  paidAt: string | null;
  periodKey: string;
  reversalRef: number;
  salesRef: number;
  shareOfGrossProfitPct: number | null;
  status: PayrollPeriodStatus;
  storeId: string;
  toDate: string;
  totalRef: number;
  updatedAt: string;
};

export type PayrollPeriodDetail = {
  breakdown: {
    afterCommissionRef: number;
    freeRef: number;
    reinvestRef: number;
    reserveRef: number;
  } | null;
  items: PayrollItem[];
  period: PayrollPeriod;
  /** Ventas de la quincena sin cajero asignado: no comisionan a nadie. */
  salesWithoutCashier: number;
  /** Ventas comisionadas por ítem, indexadas por `PayrollItem.id`. */
  salesByItem: Record<string, PayrollCommissionSale[]>;
  settings: PayrollSettings;
};

/** Estimación viva de la quincena en curso: no escribe nada en la base. */
export type PayrollEstimateRow = {
  commissionPct: number;
  commissionRef: number;
  fullName: string;
  profileId: string;
  reversalRef: number;
  salesCount: number;
  salesRef: number;
  totalRef: number;
};

export type PayrollCurrentSummary = {
  currentPeriodKey: string;
  estimate: PayrollEstimateRow[];
  estimateTotalRef: number;
  /** El periodo anterior, si ya fue calculado. */
  previousPeriod: PayrollPeriod | null;
  previousPeriodKey: string;
};

export type PayrollMineItem = {
  item: PayrollItem;
  period: PayrollPeriod;
  sales: PayrollCommissionSale[];
};

export type PayrollPayInput = {
  amount: number;
  bankName?: string | null;
  method: PaymentMethod;
  reference?: string | null;
};

/** `GET`/`PATCH /api/payroll/settings`: parámetros + la plantilla elegible. */
export type PayrollSettingsView = {
  employees: PayrollEmployee[];
  settings: PayrollSettings;
};

export type PayrollSettingsInput = {
  defaultCommissionPct?: number;
  eligibleRoles?: UserRole[];
  reinvestPct?: number;
  reservePct?: number;
  warnShareOfGrossProfitPct?: number;
};

export type PayrollEmployeeInput = {
  commissionPct: number;
  isActive?: boolean;
};

/** Anular un pago exige explicar por qué: queda en las notas de la quincena. */
export type PayrollCancelPaymentInput = {
  notes: string;
};

/**
 * Estimación viva del propio cajero. El porcentaje sale del último recibo suyo:
 * `payroll_employees` solo lo puede leer el admin, así que un vendedor sin
 * recibos previos todavía no tiene con qué estimar.
 */
export type PayrollMineCurrent = {
  commissionPct: number | null;
  currentPeriodKey: string;
  estimate: PayrollEstimateRow | null;
};
