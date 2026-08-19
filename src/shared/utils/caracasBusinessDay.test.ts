import MockDate from "mockdate";

import {
  applyCreatedAtCaracasRange,
  caracasDateRangeToUtcBounds,
  caracasDateToUtcRange,
  getCaracasIsoDate,
  isUtcTimestampInCaracasDate,
  isUtcTimestampInCaracasDateRange,
  shiftIsoDate,
} from "./caracasBusinessDay";

describe("caracasBusinessDay", () => {
  afterEach(() => {
    MockDate.reset();
  });

  it("maps a Caracas calendar day to [04:00Z, next 04:00Z)", () => {
    expect(caracasDateToUtcRange("2026-08-16")).toEqual({
      endUtcExclusive: "2026-08-17T04:00:00.000Z",
      startUtc: "2026-08-16T04:00:00.000Z",
    });
  });

  it("maps an inclusive from=to range to the same half-open UTC window", () => {
    expect(caracasDateRangeToUtcBounds("2026-08-16", "2026-08-16")).toEqual({
      endUtcExclusive: "2026-08-17T04:00:00.000Z",
      startUtc: "2026-08-16T04:00:00.000Z",
    });
  });

  it("treats 2026-08-16 Caracas as including 04:21Z and 03:20Z next UTC day", () => {
    expect(isUtcTimestampInCaracasDate("2026-08-16T04:21Z", "2026-08-16")).toBe(true);
    expect(isUtcTimestampInCaracasDate("2026-08-17T03:20Z", "2026-08-16")).toBe(true);
    expect(isUtcTimestampInCaracasDate("2026-08-16T03:23Z", "2026-08-16")).toBe(false);
  });

  it("treats 2026-08-17 Caracas as including 22:25Z and excluding 03:20Z", () => {
    expect(isUtcTimestampInCaracasDate("2026-08-17T22:25Z", "2026-08-17")).toBe(true);
    expect(isUtcTimestampInCaracasDate("2026-08-17T03:20Z", "2026-08-17")).toBe(false);
  });

  it("returns the Caracas calendar date when UTC is already the next day", () => {
    MockDate.set("2026-08-17T03:20:00.000Z");
    expect(getCaracasIsoDate()).toBe("2026-08-16");
    expect(getCaracasIsoDate(new Date("2026-08-17T03:20:00.000Z"))).toBe("2026-08-16");
  });

  it("shifts calendar dates without UTC day jumps", () => {
    expect(shiftIsoDate("2026-08-16", 1)).toBe("2026-08-17");
    expect(shiftIsoDate("2026-08-01", -1)).toBe("2026-07-31");
  });

  it("applies gte/lt created_at bounds on a query builder", () => {
    const query = {
      gte: jest.fn().mockReturnThis(),
      lt: jest.fn().mockReturnThis(),
    };

    applyCreatedAtCaracasRange(query, "2026-08-16", "2026-08-16");

    expect(query.gte).toHaveBeenCalledWith("created_at", "2026-08-16T04:00:00.000Z");
    expect(query.lt).toHaveBeenCalledWith("created_at", "2026-08-17T04:00:00.000Z");
  });

  it("ignores blank from/to when checking range membership", () => {
    expect(isUtcTimestampInCaracasDateRange("2026-08-17T04:21Z", "", "2026-08-16")).toBe(false);
    expect(isUtcTimestampInCaracasDateRange("2026-08-16T04:21Z", null, null)).toBe(true);
  });
});
