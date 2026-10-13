import { getRolePermissions, type Permission, type UserRole } from "@/shared/auth/permissions";
import type { PurchaseStatus } from "@/shared/mocks/erp-data";

import { getPurchaseActions } from "./purchaseActions";

/** El acceso real de un rol: sus permisos de `@bodega/core/permissions`. */
function accessOf(role: UserRole) {
  const granted = getRolePermissions(role);

  return { can: (permission: Permission) => granted.includes(permission), role };
}

/** Una compra de Bs 1.000 con `paidVes` pagado. */
function purchase(status: PurchaseStatus, paidVes = 0) {
  return { paidVes, status, totalVes: 1000 };
}

const OPEN: PurchaseStatus[] = ["pedido", "recibido"];
const CLOSED: PurchaseStatus[] = ["cancelado", "devuelto"];

// COM-F10 · F-G1: la fila de la lista ofrecía Cancelar, Devolver y Registrar pago a todos.
describe("getPurchaseActions", () => {
  describe("admin", () => {
    it.each(OPEN)("en %s puede cancelar, devolver, duplicar y pagar el saldo", (status) => {
      expect(getPurchaseActions(purchase(status), accessOf("admin"))).toMatchObject({
        canCancelOrReturn: true,
        canDuplicate: true,
        canPay: true,
        isOpen: true,
      });
    });

    it("solo un pedido se puede recibir", () => {
      expect(getPurchaseActions(purchase("pedido"), accessOf("admin")).canReceive).toBe(true);
      expect(getPurchaseActions(purchase("recibido"), accessOf("admin")).canReceive).toBe(false);
    });

    it.each(CLOSED)(
      "en %s no admite pago ni recepción, y cancelar o devolver quedan cerrados",
      (status) => {
        expect(getPurchaseActions(purchase(status), accessOf("admin"))).toEqual({
          canCancelOrReturn: true,
          canDuplicate: true,
          canPay: false,
          canReceive: false,
          isOpen: false,
        });
      },
    );

    it("una compra ya pagada no ofrece pagar", () => {
      expect(getPurchaseActions(purchase("recibido", 1000), accessOf("admin")).canPay).toBe(false);
      expect(getPurchaseActions(purchase("recibido", 999.5), accessOf("admin")).canPay).toBe(true);
    });
  });

  describe("contador (ve compras y gestiona pagos; no crea compras)", () => {
    it.each([...OPEN, ...CLOSED])("en %s no cancela, devuelve, recibe ni duplica", (status) => {
      expect(getPurchaseActions(purchase(status), accessOf("contador"))).toMatchObject({
        canCancelOrReturn: false,
        canDuplicate: false,
        canReceive: false,
      });
    });

    it("paga el saldo de una compra vigente y no el de una anulada o devuelta", () => {
      expect(getPurchaseActions(purchase("recibido"), accessOf("contador")).canPay).toBe(true);
      expect(getPurchaseActions(purchase("pedido"), accessOf("contador")).canPay).toBe(true);
      expect(getPurchaseActions(purchase("cancelado"), accessOf("contador")).canPay).toBe(false);
      expect(getPurchaseActions(purchase("devuelto"), accessOf("contador")).canPay).toBe(false);
    });
  });

  describe("almacén (crea y recibe compras; no ve sus pagos)", () => {
    it.each([...OPEN, ...CLOSED])("en %s nunca ofrece pagar", (status) => {
      expect(getPurchaseActions(purchase(status), accessOf("almacen")).canPay).toBe(false);
    });

    it("cancela, devuelve, duplica y recibe un pedido", () => {
      expect(getPurchaseActions(purchase("pedido"), accessOf("almacen"))).toEqual({
        canCancelOrReturn: true,
        canDuplicate: true,
        canPay: false,
        canReceive: true,
        isOpen: true,
      });
    });
  });

  it("vendedor: ninguna acción, en ningún estado", () => {
    for (const status of [...OPEN, ...CLOSED]) {
      expect(getPurchaseActions(purchase(status), accessOf("vendedor"))).toMatchObject({
        canCancelOrReturn: false,
        canDuplicate: false,
        canPay: false,
        canReceive: false,
      });
    }
  });

  it("sin rol cargado todavía no se ofrece pagar", () => {
    expect(getPurchaseActions(purchase("recibido"), { can: () => true }).canPay).toBe(false);
  });

  it("sin importes (el menú del detalle solo conoce el estado) no hay saldo que pagar", () => {
    expect(getPurchaseActions({ status: "recibido" }, accessOf("admin"))).toMatchObject({
      canCancelOrReturn: true,
      canPay: false,
    });
  });
});
