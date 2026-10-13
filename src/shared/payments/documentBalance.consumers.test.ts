/**
 * GQ-07: el MISMO documento da el MISMO veredicto en cada consumidor. Si alguno
 * vuelve a calcular el saldo por su cuenta (p. ej. comparando REF), este test falla.
 */
import { buildOpenDocument } from "@/modules/payments/services/openDocuments.mock-server";
import {
  getPurchaseBalanceRef,
  getPurchasePaymentStatus,
  hasPendingBalance,
} from "@/modules/purchases/purchases-list/utils/purchaseBalance";
import { getPurchaseActions } from "@/modules/purchases/utils/purchaseActions";

import { documentBalance } from "./documentBalance";

const access = { can: () => true, role: "admin" as const };

const base = {
  createdAt: "2026-10-12T12:00:00.000Z",
  id: "ea10fb94-d294-4b10-b61c-2b7401668cfc",
  number: "C-20261012-000011",
  refRateVes: 875.6505,
  status: "recibido" as const,
  totalRef: 161.1,
  totalVes: 141071.84,
  type: "purchase" as const,
};

describe.each([
  ["sin pagar", { paidRef: 0, paidVes: 0 }],
  ["F8: todo el REF pagado, Bs 4,54 por pagar", { paidRef: 161.1, paidVes: 141067.3 }],
  ["inverso: falta un céntimo de REF y Bs 13,30", { paidRef: 161.09, paidVes: 141058.54 }],
  ["saldada con el residuo en Bs", { paidRef: 161.11, paidVes: 141071.84 }],
  ["saldada en Bs con REF de menos", { paidRef: 150, paidVes: 141071.84 }],
])("compra %s", (_label, paid) => {
  const purchase = { ...base, ...paid };
  const verdict = documentBalance(purchase);

  it("lista de compras: filtro «Con saldo pendiente», estado de pago y columna Saldo", () => {
    expect(hasPendingBalance(purchase)).toBe(verdict.open);
    expect(getPurchasePaymentStatus(purchase)).toBe(verdict.paymentStatus);
    expect(getPurchaseBalanceRef(purchase)).toBe(verdict.pendingRef);
  });

  it("acción «Pagar» (detalle y menú de fila)", () => {
    expect(getPurchaseActions(purchase, access).canPay).toBe(verdict.open);
  });

  it("open-documents, Saldos del proveedor y Cuentas por pagar (mock): aparece solo si está abierta, con el mismo saldo", () => {
    const open = buildOpenDocument(purchase);

    expect(open !== null).toBe(verdict.open);

    if (open) {
      expect(open.pendingVes).toBe(verdict.pendingVes);
      expect(open.pendingRef).toBe(verdict.pendingRef);
    }
  });
});

describe("venta con residuo", () => {
  const sale = {
    createdAt: "2026-10-12T12:00:00.000Z",
    id: "s1",
    number: "V-000001",
    paidVes: 141067.3,
    refRateVes: 875.6505,
    status: "pendiente_pago" as const,
    totalRef: 161.1,
    totalVes: 141071.84,
    type: "sale" as const,
  };

  it("open-documents da el saldo de documentBalance; pagada no aparece", () => {
    const verdict = documentBalance(sale);

    expect(buildOpenDocument(sale)).toMatchObject({ pendingRef: verdict.pendingRef, pendingVes: 4.54 });
    expect(buildOpenDocument({ ...sale, paidVes: 141071.84, status: "pagada" })).toBeNull();
  });
});
