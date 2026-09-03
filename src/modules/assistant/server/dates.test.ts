import MockDate from "mockdate";

import {
  AssistantDateError,
  describeIsoDate,
  isValidIsoDate,
  resolveRange,
} from "./dates";

const TODAY = "2026-09-02"; // miercoles

describe("resolveRange", () => {
  afterEach(() => MockDate.reset());

  it.each([
    ["hoy", { from: "2026-09-02", to: "2026-09-02" }],
    ["ayer", { from: "2026-09-01", to: "2026-09-01" }],
    ["desde_ayer", { from: "2026-09-01", to: "2026-09-02" }],
    ["esta_semana", { from: "2026-08-31", to: "2026-09-02" }],
    ["semana_pasada", { from: "2026-08-24", to: "2026-08-30" }],
    ["este_mes", { from: "2026-09-01", to: "2026-09-02" }],
    ["mes_pasado", { from: "2026-08-01", to: "2026-08-31" }],
    ["ultimos_7_dias", { from: "2026-08-27", to: "2026-09-02" }],
    ["ultimos_30_dias", { from: "2026-08-04", to: "2026-09-02" }],
    ["ultimos_3_meses", { from: "2026-07-01", to: "2026-09-02" }],
    ["este_anio", { from: "2026-01-01", to: "2026-09-02" }],
  ] as const)("resolves the %s preset", (preset, expected) => {
    expect(resolveRange({ preset }, TODAY)).toEqual(expected);
  });

  it("uses the Caracas business day when no date is given", () => {
    // 04:30 UTC del 2 de septiembre sigue siendo el 2 en Caracas (UTC-4).
    MockDate.set("2026-09-02T04:30:00.000Z");
    expect(resolveRange(undefined, undefined, "hoy")).toEqual({
      from: "2026-09-02",
      to: "2026-09-02",
    });

    // 03:30 UTC todavia es el 1 de septiembre en Caracas.
    MockDate.set("2026-09-02T03:30:00.000Z");
    expect(resolveRange(undefined, undefined, "hoy")).toEqual({
      from: "2026-09-01",
      to: "2026-09-01",
    });
  });

  it("falls back to the default preset without input", () => {
    expect(resolveRange({}, TODAY)).toEqual({ from: "2026-08-04", to: "2026-09-02" });
  });

  it("handles month and year edges", () => {
    expect(resolveRange({ preset: "mes_pasado" }, "2026-01-15")).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
    expect(resolveRange({ preset: "mes_pasado" }, "2026-03-31")).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
    expect(resolveRange({ preset: "mes_pasado" }, "2024-03-05")).toEqual({
      from: "2024-02-01",
      to: "2024-02-29",
    });
    expect(resolveRange({ preset: "esta_semana" }, "2026-01-01")).toEqual({
      from: "2025-12-29",
      to: "2026-01-01",
    });
    expect(resolveRange({ preset: "ultimos_3_meses" }, "2026-01-10")).toEqual({
      from: "2025-11-01",
      to: "2026-01-10",
    });
  });

  it("keeps explicit ranges and completes a missing bound", () => {
    expect(resolveRange({ from: "2026-08-01", to: "2026-08-15" }, TODAY)).toEqual({
      from: "2026-08-01",
      to: "2026-08-15",
    });
    expect(resolveRange({ from: "2026-08-10" }, TODAY)).toEqual({
      from: "2026-08-10",
      to: "2026-08-10",
    });
  });

  it("swaps inverted ranges and clamps the future", () => {
    expect(resolveRange({ from: "2026-08-20", to: "2026-08-01" }, TODAY)).toEqual({
      from: "2026-08-01",
      to: "2026-08-20",
    });
    expect(resolveRange({ from: "2026-12-01", to: "2026-12-31" }, TODAY)).toEqual({
      from: "2026-09-02",
      to: "2026-09-02",
    });
  });

  it("rejects dates that do not exist", () => {
    expect(() => resolveRange({ from: "2026-02-30" }, TODAY)).toThrow(AssistantDateError);
    expect(() => resolveRange({ to: "2026-13-01" }, TODAY)).toThrow(AssistantDateError);
  });
});

describe("isValidIsoDate", () => {
  it("accepts real calendar dates only", () => {
    expect(isValidIsoDate("2024-02-29")).toBe(true);
    expect(isValidIsoDate("2026-02-29")).toBe(false);
    expect(isValidIsoDate("02/09/2026")).toBe(false);
    expect(isValidIsoDate(20260902)).toBe(false);
  });
});

describe("describeIsoDate", () => {
  it("spells the date in Spanish", () => {
    expect(describeIsoDate("2026-09-02")).toBe("miercoles 2 de septiembre de 2026");
  });
});
