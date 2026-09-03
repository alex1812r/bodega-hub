/**
 * Capital por tienda: definicion unica usada por la tool `capital_actual` y por
 * la comparacion multitienda. Documentada en `docs/modules-catalog.md`.
 *
 *   capital_ref = baul.balance_ref
 *               + (baul.balance_efectivo_ves + baul.balance_ves) / tasa_hoy
 *               + inventario_a_costo_ref
 *               + cuentas_por_cobrar_ref
 *               - cuentas_por_pagar_ref
 */

export type StoreCapitalComponents = {
  cuentasPorCobrarRef: number;
  cuentasPorPagarRef: number;
  inventarioCostoRef: number;
  vaultCuentaVes: number;
  vaultEfectivoVes: number;
  vaultRef: number;
};

export type StoreCapitalSummary = StoreCapitalComponents & {
  capitalRef: number;
  capitalVes: number;
  storeId: string;
  storeName?: string;
  tasaVes: number;
  vaultTotalVesEnRef: number;
};

function roundMoney(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/** Ventas que aun deben dinero. */
export const RECEIVABLE_SALE_STATUSES = ["pendiente_pago"] as const;

/** Compras vigentes (no canceladas ni devueltas) que aun deben pagarse. */
export const PAYABLE_PURCHASE_STATUSES = ["pedido", "recibido"] as const;

export function composeStoreCapital(input: {
  components: StoreCapitalComponents;
  rateVes: number;
  storeId: string;
  storeName?: string;
}): StoreCapitalSummary {
  const { components, rateVes } = input;
  const vaultTotalVesEnRef =
    rateVes > 0 ? (components.vaultEfectivoVes + components.vaultCuentaVes) / rateVes : 0;

  const capitalRef =
    components.vaultRef +
    vaultTotalVesEnRef +
    components.inventarioCostoRef +
    components.cuentasPorCobrarRef -
    components.cuentasPorPagarRef;

  return {
    capitalRef: roundMoney(capitalRef),
    capitalVes: roundMoney(capitalRef * rateVes),
    cuentasPorCobrarRef: roundMoney(components.cuentasPorCobrarRef),
    cuentasPorPagarRef: roundMoney(components.cuentasPorPagarRef),
    inventarioCostoRef: roundMoney(components.inventarioCostoRef),
    storeId: input.storeId,
    ...(input.storeName ? { storeName: input.storeName } : {}),
    tasaVes: roundMoney(rateVes),
    vaultCuentaVes: roundMoney(components.vaultCuentaVes),
    vaultEfectivoVes: roundMoney(components.vaultEfectivoVes),
    vaultRef: roundMoney(components.vaultRef),
    vaultTotalVesEnRef: roundMoney(vaultTotalVesEnRef),
  };
}
