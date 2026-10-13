import {
  DATE_RANGE_PRESETS,
  DATE_RANGE_PRESET_LABELS,
  RELATIVE_DATE_RANGE_PRESETS,
  findMatchingRelativePreset,
  formatDateRangeLabel,
  isValidIsoDate,
  isoWeekdayIndex,
  normalizeDateRange,
  resolveDateRangePreset,
  shiftIsoMonth,
  type RelativeDateRangePreset,
} from "./dateRangePresets";

function resolveAll(today: string) {
  return Object.fromEntries(
    RELATIVE_DATE_RANGE_PRESETS.map((preset) => {
      const { from, to } = resolveDateRangePreset(preset, today);

      return [preset, `${from}..${to}`];
    }),
  ) as Record<RelativeDateRangePreset, string>;
}

describe("resolveDateRangePreset", () => {
  it("resuelve todos los presets un viernes a mitad de mes", () => {
    expect(resolveAll("2026-10-09")).toEqual({
      last_30_days: "2026-09-10..2026-10-09",
      last_month: "2026-09-01..2026-09-30",
      last_week: "2026-09-28..2026-10-04",
      this_month: "2026-10-01..2026-10-09",
      this_week: "2026-10-05..2026-10-09",
      today: "2026-10-09..2026-10-09",
      yesterday: "2026-10-08..2026-10-08",
    });
  });

  it("cruza el año el 1 de enero (jueves)", () => {
    expect(resolveAll("2026-01-01")).toEqual({
      last_30_days: "2025-12-03..2026-01-01",
      last_month: "2025-12-01..2025-12-31",
      last_week: "2025-12-22..2025-12-28",
      this_month: "2026-01-01..2026-01-01",
      this_week: "2025-12-29..2026-01-01",
      today: "2026-01-01..2026-01-01",
      yesterday: "2025-12-31..2025-12-31",
    });
  });

  it("el 1 de marzo de un año bisiesto el mes pasado termina el 29 de febrero", () => {
    expect(resolveDateRangePreset("last_month", "2024-03-01")).toEqual({
      from: "2024-02-01",
      to: "2024-02-29",
    });
    expect(resolveDateRangePreset("yesterday", "2024-03-01")).toEqual({
      from: "2024-02-29",
      to: "2024-02-29",
    });
    expect(resolveDateRangePreset("last_30_days", "2024-03-01")).toEqual({
      from: "2024-02-01",
      to: "2024-03-01",
    });
  });

  it("el 1 de marzo de un año no bisiesto el mes pasado termina el 28 de febrero", () => {
    expect(resolveDateRangePreset("last_month", "2025-03-01")).toEqual({
      from: "2025-02-01",
      to: "2025-02-28",
    });
    expect(resolveDateRangePreset("yesterday", "2025-03-01")).toEqual({
      from: "2025-02-28",
      to: "2025-02-28",
    });
    expect(resolveDateRangePreset("last_30_days", "2025-03-01")).toEqual({
      from: "2025-01-31",
      to: "2025-03-01",
    });
  });

  it("la semana que cruza de mes empieza el lunes del mes anterior", () => {
    // Viernes 1 de marzo de 2024.
    expect(resolveDateRangePreset("this_week", "2024-03-01")).toEqual({
      from: "2024-02-26",
      to: "2024-03-01",
    });
    expect(resolveDateRangePreset("last_week", "2024-03-04")).toEqual({
      from: "2024-02-26",
      to: "2024-03-03",
    });
  });

  it("un lunes, esta semana es solo hoy y la semana pasada va de lunes a domingo", () => {
    expect(isoWeekdayIndex("2026-10-05")).toBe(0);
    expect(resolveDateRangePreset("this_week", "2026-10-05")).toEqual({
      from: "2026-10-05",
      to: "2026-10-05",
    });
    expect(resolveDateRangePreset("last_week", "2026-10-05")).toEqual({
      from: "2026-09-28",
      to: "2026-10-04",
    });
  });

  it("un domingo, esta semana va del lunes al propio domingo", () => {
    // Domingo 1 de marzo de 2026: la semana empezó en febrero.
    expect(isoWeekdayIndex("2026-03-01")).toBe(6);
    expect(resolveDateRangePreset("this_week", "2026-03-01")).toEqual({
      from: "2026-02-23",
      to: "2026-03-01",
    });
    expect(resolveDateRangePreset("last_week", "2026-03-01")).toEqual({
      from: "2026-02-16",
      to: "2026-02-22",
    });
  });

  it("el último día del mes, este mes es el mes completo", () => {
    expect(resolveDateRangePreset("this_month", "2026-02-28")).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
  });
});

describe("helpers de fecha", () => {
  it("tiene etiqueta en español para cada preset", () => {
    expect(DATE_RANGE_PRESETS.map((preset) => DATE_RANGE_PRESET_LABELS[preset])).toEqual([
      "Hoy",
      "Ayer",
      "Esta semana",
      "Semana pasada",
      "Este mes",
      "Mes pasado",
      "Últimos 30 días",
      "Personalizado",
    ]);
  });

  it("valida fechas reales", () => {
    expect(isValidIsoDate("2024-02-29")).toBe(true);
    expect(isValidIsoDate("2025-02-29")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("2026-1-1")).toBe(false);
    expect(isValidIsoDate("01/09/2026")).toBe(false);
    expect(isValidIsoDate("")).toBe(false);
    expect(isValidIsoDate(null)).toBe(false);
  });

  it("intercambia los extremos si el fin es anterior al inicio", () => {
    expect(normalizeDateRange("2026-10-09", "2026-10-02")).toEqual({
      from: "2026-10-02",
      to: "2026-10-09",
    });
  });

  it("cambia de mes conservando el día o acotándolo al último", () => {
    expect(shiftIsoMonth("2026-01-31", 1)).toBe("2026-02-28");
    expect(shiftIsoMonth("2024-01-31", 1)).toBe("2024-02-29");
    expect(shiftIsoMonth("2026-01-15", -1)).toBe("2025-12-15");
    expect(shiftIsoMonth("2026-12-15", 1)).toBe("2027-01-15");
  });

  it("reconoce el preset que corresponde a un rango", () => {
    expect(findMatchingRelativePreset("2026-09-01", "2026-09-30", "2026-10-09")).toBe("last_month");
    expect(findMatchingRelativePreset("2026-09-02", "2026-09-30", "2026-10-09")).toBeUndefined();
    expect(
      findMatchingRelativePreset("2026-09-01", "2026-09-30", "2026-10-09", ["today", "custom"]),
    ).toBeUndefined();
    expect(findMatchingRelativePreset("2026-09-01", undefined, "2026-10-09")).toBeUndefined();
  });
});

describe("formatDateRangeLabel", () => {
  it.each([
    ["2026-09-01", "2026-09-30", "1–30 sep 2026"],
    ["2026-09-28", "2026-10-04", "28 sep – 4 oct 2026"],
    ["2025-12-28", "2026-01-03", "28 dic 2025 – 3 ene 2026"],
    ["2026-10-09", "2026-10-09", "9 oct 2026"],
    ["2026-09-01", undefined, "Desde 1 sep 2026"],
    [undefined, "2026-09-30", "Hasta 30 sep 2026"],
    [undefined, undefined, "Todas las fechas"],
  ])("%s a %s → %s", (from, to, expected) => {
    expect(formatDateRangeLabel(from, to)).toBe(expected);
  });
});
