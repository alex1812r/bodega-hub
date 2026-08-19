import {
  autoCloseStaleCashSessions,
  closeCashSession,
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
