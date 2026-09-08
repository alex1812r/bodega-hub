import type { PayrollSemaphoreLevel } from "../utils/payrollMath";
import type {
  PayrollCommissionKind,
  PayrollItemStatus,
  PayrollPaidCurrency,
  PayrollPeriodStatus,
} from "../types";

export const payrollPeriodStatusLabels: Record<PayrollPeriodStatus, string> = {
  aprobado: "Aprobada",
  borrador: "Borrador",
  pagado: "Pagada",
};

export const payrollPeriodStatusVariants: Record<
  PayrollPeriodStatus,
  "default" | "info" | "success"
> = {
  aprobado: "info",
  borrador: "default",
  pagado: "success",
};

export const payrollItemStatusLabels: Record<PayrollItemStatus, string> = {
  pagado: "Pagado",
  pendiente: "Pendiente",
};

export const payrollItemStatusVariants: Record<PayrollItemStatus, "success" | "warning"> = {
  pagado: "success",
  pendiente: "warning",
};

/** Etiquetas del detalle de ventas comisionadas (§3 del plan). */
export const payrollCommissionKindLabels: Record<PayrollCommissionKind, string> = {
  late: "cobrada tarde",
  normal: "de la quincena",
  reversal: "reverso",
};

export const payrollCommissionKindVariants: Record<
  PayrollCommissionKind,
  "danger" | "default" | "warning"
> = {
  late: "warning",
  normal: "default",
  reversal: "danger",
};

export const payrollSemaphoreLabels: Record<PayrollSemaphoreLevel, string> = {
  ambar: "Atencion",
  rojo: "Alto",
  "sin-datos": "Sin datos",
  verde: "Saludable",
};

export const payrollPaidCurrencyLabels: Record<PayrollPaidCurrency, string> = {
  USD: "USD",
  VES: "Bs.",
};

/** Texto de ayuda del semáforo, fijado en §3 del plan de nómina. */
export const PAYROLL_SEMAPHORE_HELP =
  "Lo que queda despues de comisiones es lo disponible para gastos, reinversion y reserva.";
