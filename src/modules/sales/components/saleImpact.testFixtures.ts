import type { ImpactPaymentLine, ImpactStockLine } from "@/shared/impact/types";

import type { SaleImpact, SaleImpactAction } from "../services/saleImpact";

/** Datos de prueba de los modales de anular / devolver venta. Solo para jest y stories. */

export const IMPACT_SALE_ID = "sale-cnf";

export function impactStockLine(overrides: Partial<ImpactStockLine> = {}): ImpactStockLine {
  return {
    inexact: null,
    isActive: true,
    productId: "prod-harina",
    productName: "Harina PAN 1 kg",
    quantityDelta: 3,
    sku: "HAR-1",
    stockAfter: 10,
    stockBefore: 7,
    ...overrides,
  };
}

export function impactPaymentLine(overrides: Partial<ImpactPaymentLine> = {}): ImpactPaymentLine {
  return {
    amount: 7650,
    amountRef: 15,
    amountVes: 7650,
    changeVes: 0,
    currency: "VES",
    description: "Se anula: se revierte de la caja «Caja 1».",
    effects: [
      {
        balanceAfter: null,
        balanceBefore: null,
        currency: "VES",
        delta: -7650,
        note: null,
        physical: true,
        target: "caja",
        targetName: "Caja 1",
      },
    ],
    inexact: null,
    method: "efectivo_ves",
    netVes: 7650,
    outcome: "reverted",
    paymentId: "pay-1",
    status: "activo",
    statusAfter: "anulado",
    ...overrides,
  };
}

type AllowedOverrides = Partial<
  Pick<SaleImpact, "document" | "inexact" | "paidVes" | "paidVesAfter" | "payments" | "refund" | "stock">
>;

/** Impact permitido: sin pagos, un producto que vuelve al stock. */
export function allowedSaleImpact(
  action: SaleImpactAction,
  overrides: AllowedOverrides = {},
): SaleImpact {
  return {
    action,
    allowed: true,
    document: {
      contactName: "María Pérez",
      id: IMPACT_SALE_ID,
      number: "V-20261009-000007",
      status: "pagada",
      statusAfter: action === "cancel" ? "cancelada" : "devuelta",
    },
    inexact: null,
    paidVes: 0,
    paidVesAfter: 0,
    payments: [],
    reason: null,
    reasonCode: null,
    refund: action === "return" ? { byMethod: [], changeToRecover: [], netVes: 0 } : null,
    stock: [impactStockLine()],
    ...overrides,
  };
}

/** Impact rechazado: no proyecta nada (estados y saldos "después" = "antes"). */
export function rejectedSaleImpact(
  action: SaleImpactAction,
  reason: string,
  overrides: Pick<AllowedOverrides, "paidVes" | "payments" | "stock"> & {
    status?: SaleImpact["document"]["status"];
  } = {},
): SaleImpact {
  const { status = "pagada", ...rest } = overrides;
  const paidVes = rest.paidVes ?? 0;

  return {
    action,
    allowed: false,
    document: {
      contactName: "María Pérez",
      id: IMPACT_SALE_ID,
      number: "V-20261009-000007",
      status,
      statusAfter: status,
    },
    inexact: null,
    payments: rest.payments ?? [],
    paidVes,
    paidVesAfter: paidVes,
    reason,
    reasonCode: "CONFLICT",
    refund: null,
    stock: rest.stock ?? [impactStockLine({ quantityDelta: 0, stockAfter: 7 })],
  };
}

export const CANCEL_BLOCKED_REASON =
  "La venta V-20261009-000007 tiene 1 pago(s) activo(s) por Bs 7650.00. Anula primero los pagos y luego cancela la venta.";

export function blockingPaymentLine(overrides: Partial<ImpactPaymentLine> = {}) {
  return impactPaymentLine({
    description: "Sigue activo: hay que anularlo antes de anular la venta.",
    effects: [],
    outcome: "blocks_action",
    statusAfter: "activo",
    ...overrides,
  });
}
