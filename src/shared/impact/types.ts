/**
 * Contrato común de los endpoints `GET /api/<doc>/[id]/impact?action=` (CNF-14).
 *
 * Un impact describe, SIN escribir, lo que la RPC de la acción hará de verdad
 * sobre ese documento. Lo consumen los `ConfirmActionModal` de ventas, compras
 * y pagos. Reglas del contrato:
 *
 * - Las cifras salen de lo guardado (stock, asientos de caja y baúl), nunca de
 *   una estimación. Si una parte no se puede predecir con exactitud lleva
 *   `inexact: { reason }` y sus cifras quedan en `null` o sin asientos.
 * - `allowed = false` significa que la RPC rechazaría la acción con `reason`
 *   (el mismo mensaje) y `reasonCode`. En ese caso no se aplica nada y el impact
 *   no proyecta nada: estados y saldos "después" iguales a los de "antes",
 *   `quantityDelta` 0 y pagos sin asientos; el pago que causa el rechazo lleva
 *   `outcome: "blocks_action"`.
 */
import type { PaymentMethod, PaymentStatus } from "@/shared/mocks/erp-data";

/** Parte del efecto que no se pudo calcular con exactitud y por qué. */
export type ImpactInexact = {
  reason: string;
};

/** Código con el que la RPC rechazaría la acción (mismo vocabulario que `ApiErrorCode`). */
export type ImpactRejectionCode = "BAD_REQUEST" | "CONFLICT" | "FORBIDDEN" | "NOT_FOUND";

export type ImpactVerdict =
  | { allowed: true; reason: null; reasonCode: null }
  | { allowed: false; reason: string; reasonCode: ImpactRejectionCode };

/** Stock de un producto antes → después de la acción. */
export type ImpactStockLine = {
  inexact: ImpactInexact | null;
  /** `false`: el producto está inactivo; la RPC mueve su stock igual. */
  isActive: boolean | null;
  productId: string;
  productName: string | null;
  /** Unidades que mueve la acción, con signo (+ entra al stock, − sale). 0 = no se mueve. */
  quantityDelta: number;
  sku: string | null;
  stockAfter: number | null;
  stockBefore: number | null;
};

/** Dónde vive el dinero que toca un pago. */
export type ImpactMoneyTarget = "baul_cuenta" | "baul_efectivo_ves" | "baul_ref" | "caja";

/** Un asiento de caja o de baúl que la acción revierte. */
export type ImpactMoneyEffect = {
  /**
   * Saldo de la cubeta del baúl después de este asiento. `null` en `caja`: el
   * efectivo de la gaveta no se recalcula aquí.
   */
  balanceAfter: number | null;
  balanceBefore: number | null;
  currency: "USD" | "VES";
  /** Cambio sobre el saldo de `target`, con signo, en `currency`. */
  delta: number;
  /** Aclaración honesta de ese asiento (caja ya cerrada, saldo recortado a 0…). */
  note: string | null;
  /** `false`: asiento informativo de la sesión (cobro o vuelto por cuenta), no mueve la gaveta. */
  physical: boolean;
  /**
   * `true`: quien pide el impact no tiene el permiso de lectura de ese destino
   * (`cash.view` para la caja, `vault.view` para el baúl). El asiento viaja con
   * su monto, pero sin nombre de caja, sin notas y sin saldos (AUD-01).
   */
  restricted?: true;
  target: ImpactMoneyTarget;
  /** Nombre de la caja cuando `target = "caja"`. */
  targetName: string | null;
};

/**
 * Qué pasa con un pago del documento:
 * - `reverted`: la acción lo anula y revierte sus asientos (`effects`).
 * - `already_cancelled`: ya estaba anulado, nada que revertir.
 * - `blocks_action`: sigue activo y por él la RPC rechaza la acción.
 * - `unchanged`: la acción no lo toca.
 */
export type ImpactPaymentOutcome = "already_cancelled" | "blocks_action" | "reverted" | "unchanged";

export type ImpactPaymentLine = {
  /** Monto en la moneda del pago (`currency`). */
  amount: number;
  amountRef: number;
  amountVes: number;
  /** Vuelto entregado en ese cobro, en Bs. */
  changeVes: number;
  currency: "USD" | "VES";
  /** Frase lista para mostrar con lo que pasa con el pago. */
  description: string;
  effects: ImpactMoneyEffect[];
  inexact: ImpactInexact | null;
  method: PaymentMethod;
  /** Lo que el pago aportó al documento: `amountVes − changeVes`. */
  netVes: number;
  outcome: ImpactPaymentOutcome;
  paymentId: string;
  status: PaymentStatus;
  statusAfter: PaymentStatus;
};

/** Dinero por método, en la moneda de ese método. */
export type ImpactMethodAmount = {
  amount: number;
  amountVes: number;
  currency: "USD" | "VES";
  method: PaymentMethod;
};

/** Cabecera del documento afectado. */
export type ImpactDocument<TStatus extends string> = {
  contactName: string | null;
  id: string;
  number: string;
  status: TStatus;
  /** Estado tras la acción; igual a `status` si `allowed = false`. */
  statusAfter: TStatus;
};
