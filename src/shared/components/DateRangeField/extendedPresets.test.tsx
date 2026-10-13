/**
 * REP-F3 · presets opcionales de `DateRangeField`: "Últimos 14 días", "Últimos
 * 3 meses", "Últimos 6 meses" y "Desde el inicio". No salen por defecto: solo
 * si el consumidor los pasa en `presets`.
 */
import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { DateRangeField } from "./DateRangeField";
import {
  ALL_DATE_RANGE_PRESETS,
  type AnyDateRangePreset,
  DATE_RANGE_PRESET_LABELS,
  DATE_RANGE_PRESETS,
  type DateRangeChange,
  type DateRangeValue,
  EXTENDED_DATE_RANGE_PRESETS,
  findMatchingRelativePreset,
  formatDateRangeLabel,
  isAnyDateRangePreset,
  isDateRangePreset,
  RELATIVE_DATE_RANGE_PRESETS,
  resolveDateRangePreset,
  resolveDateRangePresetBounds,
} from "./dateRangePresets";
import { parseDateRangeParams, serializeDateRange } from "./dateRangeUrl";

const TODAY = "2026-10-09";
const DEFAULT_CHIPS = [
  "Hoy",
  "Ayer",
  "Esta semana",
  "Semana pasada",
  "Este mes",
  "Mes pasado",
  "Últimos 30 días",
  "Personalizado",
];
const EXTENDED_CHIPS = ["Últimos 14 días", "Últimos 3 meses", "Últimos 6 meses", "Desde el inicio"];

describe("presets opcionales · ids y etiquetas", () => {
  it("los ids son estables y no entran en la lista por defecto", () => {
    expect(EXTENDED_DATE_RANGE_PRESETS).toEqual([
      "last_14_days",
      "last_3_months",
      "last_6_months",
      "all_time",
    ]);
    expect(DATE_RANGE_PRESETS).toEqual([
      "today",
      "yesterday",
      "this_week",
      "last_week",
      "this_month",
      "last_month",
      "last_30_days",
      "custom",
    ]);
    expect(RELATIVE_DATE_RANGE_PRESETS).toHaveLength(7);
    expect(ALL_DATE_RANGE_PRESETS).toEqual([...DATE_RANGE_PRESETS, ...EXTENDED_DATE_RANGE_PRESETS]);
    expect(EXTENDED_DATE_RANGE_PRESETS.map((preset) => DATE_RANGE_PRESET_LABELS[preset])).toEqual(
      EXTENDED_CHIPS,
    );
  });

  it("isDateRangePreset sigue siendo solo de los de por defecto", () => {
    for (const preset of EXTENDED_DATE_RANGE_PRESETS) {
      expect(isDateRangePreset(preset)).toBe(false);
      expect(isAnyDateRangePreset(preset)).toBe(true);
    }

    expect(isAnyDateRangePreset("last_30_days")).toBe(true);
    expect(isAnyDateRangePreset("last_year")).toBe(false);
  });
});

describe("presets opcionales · rangos (N días contando hoy, inclusivos)", () => {
  it.each([
    // [hoy, 14 días, 90 días, 180 días]
    ["2026-10-09", "2026-09-26", "2026-07-12", "2026-04-13"],
    // Fin de mes de 31: febrero (28) y los meses de 30 no descuadran la cuenta.
    ["2026-03-31", "2026-03-18", "2026-01-01", "2025-10-03"],
    ["2026-05-31", "2026-05-18", "2026-03-03", "2025-12-03"],
    // Cambio de año.
    ["2026-01-05", "2025-12-23", "2025-10-08", "2025-07-10"],
    // Año bisiesto: el 29 de febrero cuenta como un día más.
    ["2024-03-01", "2024-02-17", "2023-12-03", "2023-09-04"],
  ])("hoy %s", (today, from14, from90, from180) => {
    expect(resolveDateRangePreset("last_14_days", today)).toEqual({ from: from14, to: today });
    expect(resolveDateRangePreset("last_3_months", today)).toEqual({ from: from90, to: today });
    expect(resolveDateRangePreset("last_6_months", today)).toEqual({ from: from180, to: today });
  });

  it("3 y 6 meses son 90 y 180 días, no meses de calendario", () => {
    const days = (from: string, to: string) =>
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;

    expect(days(resolveDateRangePreset("last_14_days", TODAY).from, TODAY)).toBe(14);
    expect(days(resolveDateRangePreset("last_3_months", TODAY).from, TODAY)).toBe(90);
    expect(days(resolveDateRangePreset("last_6_months", TODAY).from, TODAY)).toBe(180);
  });

  it("all_time no tiene límite inferior y llega hasta hoy", () => {
    expect(resolveDateRangePresetBounds("all_time", TODAY)).toEqual({ from: undefined, to: TODAY });
    expect(resolveDateRangePresetBounds("last_14_days", TODAY)).toEqual({
      from: "2026-09-26",
      to: TODAY,
    });
  });

  it("el texto de all_time es «Desde el inicio»", () => {
    expect(formatDateRangeLabel(undefined, TODAY, "all_time")).toBe("Desde el inicio");
    expect(formatDateRangeLabel(undefined, TODAY)).toBe("Hasta 9 oct 2026");
  });

  it("un rango que coincide con un preset opcional solo se reconoce si es candidato", () => {
    expect(findMatchingRelativePreset("2026-09-26", TODAY, TODAY)).toBeUndefined();
    expect(
      findMatchingRelativePreset("2026-09-26", TODAY, TODAY, ALL_DATE_RANGE_PRESETS),
    ).toBe("last_14_days");
  });
});

describe("presets opcionales · URL", () => {
  function parseExtended(query: string) {
    return parseDateRangeParams<AnyDateRangePreset>(
      new URLSearchParams(query),
      TODAY,
      ALL_DATE_RANGE_PRESETS,
    );
  }

  it.each([
    ["last_14_days", "2026-09-26"],
    ["last_3_months", "2026-07-12"],
    ["last_6_months", "2026-04-13"],
    ["all_time", undefined],
  ] as const)("?preset=%s hace ida y vuelta", (preset, from) => {
    const parsed = parseExtended(`preset=${preset}`);

    expect(parsed).toEqual({ from, preset, to: TODAY });
    expect(serializeDateRange(parsed)).toEqual({ from: "", preset, to: "" });
    expect(parseExtended(new URLSearchParams(serializeDateRange(parsed)).toString())).toEqual(parsed);
  });

  it("un consumidor que no los admite los ignora, como cualquier preset desconocido", () => {
    const none = { from: undefined, preset: undefined, to: undefined };

    for (const preset of EXTENDED_DATE_RANGE_PRESETS) {
      expect(parseDateRangeParams(new URLSearchParams(`preset=${preset}`), TODAY)).toEqual(none);
    }

    expect(parseDateRangeParams(new URLSearchParams("preset=last_14_days&from=2026-09-26&to=2026-10-09"), TODAY)).toEqual({
      from: "2026-09-26",
      preset: "custom",
      to: TODAY,
    });
  });

  it("all_time con otras fechas en la URL deja de ser all_time", () => {
    expect(parseExtended("preset=all_time&from=2026-09-01&to=2026-09-30")).toEqual({
      from: "2026-09-01",
      preset: "custom",
      to: "2026-09-30",
    });
    expect(parseExtended(`preset=all_time&to=${TODAY}`)).toEqual({
      from: undefined,
      preset: "all_time",
      to: TODAY,
    });
  });
});

describe("presets opcionales · render", () => {
  const PRESETS: readonly AnyDateRangePreset[] = [
    ...DATE_RANGE_PRESETS.filter((preset) => preset !== "custom"),
    ...EXTENDED_DATE_RANGE_PRESETS,
    "custom",
  ];

  function Harness({ onChange }: { onChange: (next: DateRangeChange<AnyDateRangePreset>) => void }) {
    const [value, setValue] = useState<DateRangeValue<AnyDateRangePreset>>({});

    return (
      <DateRangeField
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
        presets={PRESETS}
        today={TODAY}
        value={value}
      />
    );
  }

  function chips() {
    return within(screen.getByRole("group", { name: "Rango de fechas" }))
      .getAllByRole("button")
      .map((button) => button.textContent);
  }

  it("por defecto NO se ven: los chips son exactamente los ocho de siempre", () => {
    render(<DateRangeField onChange={jest.fn()} today={TODAY} value={{}} />);

    expect(chips()).toEqual(DEFAULT_CHIPS);

    for (const name of EXTENDED_CHIPS) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("por defecto un rango de 14 días se pinta como personalizado", () => {
    render(
      <DateRangeField
        onChange={jest.fn()}
        today={TODAY}
        value={{ from: "2026-09-26", to: TODAY }}
      />,
    );

    expect(screen.getByRole("button", { name: /Personalizado/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("con `presets` sí se ven, en el orden pedido", () => {
    render(<Harness onChange={jest.fn()} />);

    expect(chips()).toEqual([...DEFAULT_CHIPS.slice(0, 7), ...EXTENDED_CHIPS, "Personalizado"]);
  });

  it("un clic emite el rango ya calculado y marca el chip", async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Últimos 3 meses" }));

    expect(onChange).toHaveBeenLastCalledWith({
      from: "2026-07-12",
      preset: "last_3_months",
      to: TODAY,
    });
    expect(screen.getByRole("button", { name: "Últimos 3 meses" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("date-range-label")).toHaveTextContent("12 jul – 9 oct 2026");
  });

  it("«Desde el inicio» emite from undefined y el texto del rango lo dice", async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Desde el inicio" }));

    expect(onChange).toHaveBeenLastCalledWith({ from: undefined, preset: "all_time", to: TODAY });
    expect(screen.getByRole("button", { name: "Desde el inicio" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("date-range-label")).toHaveTextContent("Desde el inicio");
  });

  it("con solo `preset: all_time` en el valor se pinta resuelto", () => {
    render(
      <DateRangeField
        onChange={jest.fn()}
        presets={PRESETS}
        today={TODAY}
        value={{ preset: "all_time" }}
      />,
    );

    expect(screen.getByRole("button", { name: "Desde el inicio" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("date-range-label")).toHaveTextContent("Desde el inicio");
  });
});
