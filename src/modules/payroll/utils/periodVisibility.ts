import { type PayrollPeriod } from "../types";

/**
 * Lo que un cajero puede ver de la quincena.
 *
 * `payroll.view_own` le da acceso a su recibo, no a las cuentas del negocio: la
 * fila de `payroll_periods` trae la ganancia bruta, el semáforo y los totales de
 * **todos** los cajeros. Se recortan aquí, en el servicio, y no en la pantalla,
 * para que tampoco viajen por la red.
 */
export function redactPeriodForCashier(period: PayrollPeriod): PayrollPeriod {
  return {
    ...period,
    commissionRef: 0,
    grossProfitRef: null,
    reversalRef: 0,
    salesRef: 0,
    shareOfGrossProfitPct: null,
    totalRef: 0,
  };
}
