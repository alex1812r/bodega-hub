/**
 * Cuerpos de las peticiones que el BFF valida campo a campo. Sin red: funciones
 * puras, probadas en `phases.test.ts`.
 */
import { roundMoney } from "@bodega/core";

/** Tasa con la que se registra un documento: la fila vigente de la tienda. */
export type RateContext = { exchangeRateId?: string; refRateVes: number };

export type PurchaseLineSeed = { productId: string; quantity: number; unitCostRef: number };

export type PurchaseBodyInput = {
  lines: readonly PurchaseLineSeed[];
  notes?: string;
  rate: RateContext;
  status: "pedido" | "recibido";
  supplierId: string;
};

/**
 * Cuerpo de `POST /api/purchases`: líneas por unidad con costo en REF, exentas
 * de IVA (`taxRate: 0`), y los totales de cabecera que el servidor exige
 * (subtotal, impuesto y descuento en REF y en Bs).
 */
export function buildPurchaseBody({ lines, notes, rate, status, supplierId }: PurchaseBodyInput) {
  const items = lines.map((line) => {
    const subtotalRef = roundMoney(line.quantity * line.unitCostRef);

    return {
      costCurrency: "ref" as const,
      entryMode: "unit" as const,
      productId: line.productId,
      quantity: line.quantity,
      subtotalRef,
      subtotalVes: roundMoney(subtotalRef * rate.refRateVes),
      taxRate: 0,
      taxRef: 0,
      taxVes: 0,
      unitCostRef: line.unitCostRef,
      unitCostVes: roundMoney(line.unitCostRef * rate.refRateVes),
    };
  });

  return {
    supplierId,
    status,
    items,
    subtotalRef: roundMoney(items.reduce((sum, item) => sum + item.subtotalRef, 0)),
    subtotalVes: roundMoney(items.reduce((sum, item) => sum + item.subtotalVes, 0)),
    taxRef: 0,
    taxVes: 0,
    discountRef: 0,
    discountVes: 0,
    ...(rate.exchangeRateId ? { exchangeRateId: rate.exchangeRateId } : {}),
    refRateVes: rate.refRateVes,
    ...(notes ? { notes } : {}),
  };
}

/**
 * Parte un total en dos abonos que suman exactamente el total (al céntimo): el
 * segundo es el resto, no otra multiplicación.
 */
export function splitAmount(total: number, firstShare: number): [number, number] {
  const first = roundMoney(total * firstShare);

  return [first, roundMoney(total - first)];
}
