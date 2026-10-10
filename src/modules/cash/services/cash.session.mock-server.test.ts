import {
  autoCloseStaleCashSessions,
  closeCashSession,
  getCashSessionOwner,
  getCurrentCashSession,
  openCashSession,
} from "./cash.session.mock-server";
import { createCashRegister, updateCashRegister } from "./cash.registers.mock-server";

const storeId = "store-test-cash-auto-close";
const userId = "user-vendor-cash";

describe("autoCloseStaleCashSessions mock", () => {
  it("closes a session opened more than a Caracas day ago and leaves a fresh one open", () => {
    const register = createCashRegister({ name: `Caja ${Date.now()}` }, storeId);
    updateCashRegister(register.id, { assignedUserId: userId }, storeId);

    const stale = openCashSession({ openingVes: 10, openingRef: 1, registerId: register.id }, userId, storeId);
    stale.openedAt = "2026-08-16T12:00:00.000Z";

    const result = autoCloseStaleCashSessions(new Date("2026-08-17T04:00:00.000Z"));

    expect(result.closedCount).toBe(1);
    expect(stale.status).toBe("closed");
    expect(stale.closedReason).toBe("end_of_day");
    expect(stale.closingVes).toBe(10);
    expect(stale.closingRef).toBe(1);
    expect(getCurrentCashSession(userId, storeId)).toBeNull();
  });

  it("does not close a session opened two hours ago", () => {
    const userIdFresh = `${userId}-fresh`;
    const register = createCashRegister({ name: `Caja fresh ${Date.now()}` }, storeId);
    updateCashRegister(register.id, { assignedUserId: userIdFresh }, storeId);
    const session = openCashSession(
      { openingVes: 0, openingRef: 0, registerId: register.id },
      userIdFresh,
      storeId,
    );
    session.openedAt = "2026-08-18T14:00:00.000Z";

    const result = autoCloseStaleCashSessions(new Date("2026-08-18T16:00:00.000Z"));

    expect(result.closedCount).toBe(0);
    expect(session.status).toBe("open");
    closeCashSession({ sessionId: session.id, closingRef: 0, closingVes: 0 }, userIdFresh, storeId);
  });
});

describe("reglas de turno del que opera caja (POS-F3, paridad con el BFF real)", () => {
  const store = "store-test-cash-rules";

  it("solo se abre la caja asignada, un turno a la vez, y cada quien cierra el que abrió", () => {
    const mine = createCashRegister({ name: "Caja reglas A" }, store);
    const other = createCashRegister({ name: "Caja reglas B" }, store);
    const spare = createCashRegister({ name: "Caja reglas C" }, store);
    updateCashRegister(mine.id, { assignedUserId: "ana" }, store);
    updateCashRegister(other.id, { assignedUserId: "luis" }, store);

    expect(() => openCashSession({ registerId: other.id }, "ana", store)).toThrow(
      expect.objectContaining({ status: 403 }),
    );

    const first = openCashSession({ registerId: mine.id }, "ana", store);
    const foreign = openCashSession({ registerId: other.id }, "luis", store);

    expect(getCashSessionOwner(first.id, store)).toEqual({ openedBy: "ana" });
    expect(getCashSessionOwner(first.id, "otra-tienda")).toBeNull();
    expect(() => openCashSession({ registerId: mine.id }, "ana", store)).toThrow(
      expect.objectContaining({ status: 400 }),
    );

    // La caja se reasigna con el turno todavía abierto: el turno sigue siendo de quien lo abrió.
    updateCashRegister(mine.id, { assignedUserId: null }, store);
    updateCashRegister(spare.id, { assignedUserId: "ana" }, store);

    expect(() => openCashSession({ registerId: spare.id }, "ana", store)).toThrow(
      expect.objectContaining({ code: "CONFLICT", status: 409 }),
    );
    expect(getCurrentCashSession("ana", store)?.id).toBe(first.id);
    expect(() =>
      closeCashSession({ closingRef: 0, closingVes: 0, sessionId: foreign.id }, "ana", store),
    ).toThrow(expect.objectContaining({ status: 403 }));
    expect(closeCashSession({ closingRef: 0, closingVes: 0, sessionId: first.id }, "ana", store).status).toBe(
      "closed",
    );
    expect(openCashSession({ registerId: spare.id }, "ana", store).status).toBe("open");
  });
});
