import {
  currentPeriodKey,
  formatPeriodLabel,
  isPayrollPeriodKey,
  isPeriodClosed,
  lastDayOfMonth,
  nextPeriodKey,
  parsePeriodKey,
  periodKeyForDate,
  periodUtcBounds,
  previousPeriodKey,
  recentPeriodKeys,
} from "./quincena";

describe("parsePeriodKey", () => {
  it("Q1 va del 1 al 15", () => {
    expect(parsePeriodKey("2026-09-Q1")).toEqual({
      fromDate: "2026-09-01",
      half: 1,
      month: 9,
      periodKey: "2026-09-Q1",
      toDate: "2026-09-15",
      year: 2026,
    });
  });

  it("Q2 termina el último día del mes", () => {
    expect(parsePeriodKey("2026-09-Q2")?.toDate).toBe("2026-09-30");
    expect(parsePeriodKey("2026-01-Q2")?.toDate).toBe("2026-01-31");
  });

  it("resuelve febrero común y bisiesto", () => {
    expect(parsePeriodKey("2026-02-Q2")?.toDate).toBe("2026-02-28");
    expect(parsePeriodKey("2028-02-Q2")?.toDate).toBe("2028-02-29");
    expect(parsePeriodKey("2100-02-Q2")?.toDate).toBe("2100-02-28");
  });

  it("rechaza claves inválidas", () => {
    expect(parsePeriodKey("2026-13-Q1")).toBeNull();
    expect(parsePeriodKey("2026-00-Q1")).toBeNull();
    expect(parsePeriodKey("2026-09-Q3")).toBeNull();
    expect(parsePeriodKey("2026-9-Q1")).toBeNull();
    expect(parsePeriodKey("septiembre")).toBeNull();
    expect(parsePeriodKey("")).toBeNull();
  });

  it("isPayrollPeriodKey valida el formato", () => {
    expect(isPayrollPeriodKey("2026-09-Q2")).toBe(true);
    expect(isPayrollPeriodKey("2026-09")).toBe(false);
    expect(isPayrollPeriodKey(42)).toBe(false);
  });
});

describe("lastDayOfMonth", () => {
  it("cubre meses de 28, 29, 30 y 31 días", () => {
    expect(lastDayOfMonth(2026, 2)).toBe(28);
    expect(lastDayOfMonth(2028, 2)).toBe(29);
    expect(lastDayOfMonth(2026, 4)).toBe(30);
    expect(lastDayOfMonth(2026, 12)).toBe(31);
  });
});

describe("periodKeyForDate", () => {
  it("parte el mes en el día 15", () => {
    expect(periodKeyForDate("2026-09-01")).toBe("2026-09-Q1");
    expect(periodKeyForDate("2026-09-15")).toBe("2026-09-Q1");
    expect(periodKeyForDate("2026-09-16")).toBe("2026-09-Q2");
    expect(periodKeyForDate("2026-09-30")).toBe("2026-09-Q2");
  });
});

describe("previousPeriodKey / nextPeriodKey", () => {
  it("cruza el cambio de mes", () => {
    expect(previousPeriodKey("2026-09-Q2")).toBe("2026-09-Q1");
    expect(previousPeriodKey("2026-09-Q1")).toBe("2026-08-Q2");
    expect(nextPeriodKey("2026-09-Q1")).toBe("2026-09-Q2");
    expect(nextPeriodKey("2026-09-Q2")).toBe("2026-10-Q1");
  });

  it("cruza el cambio de año", () => {
    expect(nextPeriodKey("2026-12-Q2")).toBe("2027-01-Q1");
    expect(previousPeriodKey("2027-01-Q1")).toBe("2026-12-Q2");
  });

  it("devuelve null con claves inválidas", () => {
    expect(previousPeriodKey("nope")).toBeNull();
    expect(nextPeriodKey("nope")).toBeNull();
  });
});

describe("currentPeriodKey / isPeriodClosed", () => {
  it("usa el día operativo Caracas, no el UTC", () => {
    // 2026-09-16T02:00Z todavía es 15 de septiembre en Caracas (UTC-4).
    expect(currentPeriodKey(new Date("2026-09-16T02:00:00.000Z"))).toBe("2026-09-Q1");
    // A las 04:00Z ya cambió el día operativo.
    expect(currentPeriodKey(new Date("2026-09-16T04:00:00.000Z"))).toBe("2026-09-Q2");
  });

  it("la quincena en curso no está cerrada", () => {
    const now = new Date("2026-09-20T12:00:00.000Z");

    expect(isPeriodClosed("2026-09-Q2", now)).toBe(false);
    expect(isPeriodClosed("2026-09-Q1", now)).toBe(true);
  });

  it("una quincena solo cierra cuando su último día ya pasó", () => {
    // 15-sep 23:00 Caracas: Q1 aún corre.
    expect(isPeriodClosed("2026-09-Q1", new Date("2026-09-16T03:00:00.000Z"))).toBe(false);
    // 16-sep 00:00 Caracas: Q1 cerró.
    expect(isPeriodClosed("2026-09-Q1", new Date("2026-09-16T04:00:00.000Z"))).toBe(true);
  });

  it("una quincena futura nunca está cerrada", () => {
    expect(isPeriodClosed("2027-01-Q1", new Date("2026-09-20T12:00:00.000Z"))).toBe(false);
  });
});

describe("periodUtcBounds", () => {
  it("abre y cierra a las 04:00Z", () => {
    expect(periodUtcBounds("2026-09-Q1")).toEqual({
      endUtcExclusive: "2026-09-16T04:00:00.000Z",
      startUtc: "2026-09-01T04:00:00.000Z",
    });
  });

  it("el fin de Q2 salta al primer día del mes siguiente", () => {
    expect(periodUtcBounds("2026-09-Q2")?.endUtcExclusive).toBe("2026-10-01T04:00:00.000Z");
    expect(periodUtcBounds("2026-12-Q2")?.endUtcExclusive).toBe("2027-01-01T04:00:00.000Z");
    expect(periodUtcBounds("2028-02-Q2")?.endUtcExclusive).toBe("2028-03-01T04:00:00.000Z");
  });

  it("devuelve null con una clave inválida", () => {
    expect(periodUtcBounds("nope")).toBeNull();
  });
});

describe("formatPeriodLabel", () => {
  it("describe la quincena en español", () => {
    expect(formatPeriodLabel("2026-09-Q1")).toBe("1ª quincena de septiembre 2026");
    expect(formatPeriodLabel("2026-12-Q2")).toBe("2ª quincena de diciembre 2026");
  });

  it("devuelve la clave tal cual si no se puede interpretar", () => {
    expect(formatPeriodLabel("nope")).toBe("nope");
  });
});

describe("recentPeriodKeys", () => {
  it("lista las quincenas cerradas más recientes", () => {
    expect(recentPeriodKeys(3, new Date("2026-01-20T12:00:00.000Z"))).toEqual([
      "2026-01-Q1",
      "2025-12-Q2",
      "2025-12-Q1",
    ]);
  });
});
