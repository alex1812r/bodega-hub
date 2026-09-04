/**
 * Metodos de pago soportados por el backend. Vive en `core` porque las
 * validaciones por metodo (`../payments/paymentMethods`) y la app movil lo
 * necesitan sin arrastrar los mocks de la web.
 */
export type PaymentMethod =
  | "efectivo_usd"
  | "efectivo_ves"
  | "pago_movil"
  | "punto_venta"
  | "transferencia";

export type PaymentDirection = "entrada" | "salida";

export type PaymentStatus = "activo" | "anulado";
