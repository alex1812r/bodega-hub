import MockDate from "mockdate";

import {
  cashSessionAutoCloseReason,
  cashSessionDeadlineUtc,
  cashSessionRemainingMs,
  formatCashSessionRemaining,
  isCashSessionExpired,
} from "./cashSessionDeadline";

describe("cashSessionDeadline", () => {
  afterEach(() => {
    MockDate.reset();
  });

  it("closes at Caracas midnight when opened at 08:00 Caracas", () => {
    const openedAt = "2026-08-18T12:00:00.000Z";
    expect(cashSessionDeadlineUtc(openedAt).toISOString()).toBe("2026-08-19T04:00:00.000Z");
    expect(cashSessionAutoCloseReason(openedAt)).toBe("end_of_day");
    expect(isCashSessionExpired(openedAt, new Date("2026-08-19T03:59:59.000Z"))).toBe(false);
    expect(isCashSessionExpired(openedAt, new Date("2026-08-19T04:00:00.000Z"))).toBe(true);
  });

  it("closes at Caracas midnight when opened at 23:30 Caracas (~30 min)", () => {
    const openedAt = "2026-08-19T03:30:00.000Z";
    expect(cashSessionDeadlineUtc(openedAt).toISOString()).toBe("2026-08-19T04:00:00.000Z");
    expect(cashSessionAutoCloseReason(openedAt)).toBe("end_of_day");
    expect(isCashSessionExpired(openedAt, new Date("2026-08-19T03:59:00.000Z"))).toBe(false);
    expect(isCashSessionExpired(openedAt, new Date("2026-08-19T04:00:00.000Z"))).toBe(true);
  });

  it("uses the 24h cap when it is sooner than next midnight", () => {
    const openedAt = "2026-08-18T04:00:00.000Z";
    expect(cashSessionDeadlineUtc(openedAt).toISOString()).toBe("2026-08-19T04:00:00.000Z");
    expect(cashSessionAutoCloseReason(openedAt)).toBe("end_of_day");
  });

  it("formats remaining time", () => {
    expect(formatCashSessionRemaining(90 * 60 * 1000 + 5000)).toBe("1 h 30 min");
    expect(formatCashSessionRemaining(65 * 1000)).toBe("1 min 05 s");
    expect(formatCashSessionRemaining(9000)).toBe("9 s");
    expect(cashSessionRemainingMs("2026-08-19T03:30:00.000Z", new Date("2026-08-19T03:45:00.000Z"))).toBe(
      15 * 60 * 1000,
    );
  });
});
