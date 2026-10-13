import { z } from "zod";

import { listParams } from "@/shared/hooks/useUrlListState";

import { DATE_RANGE_PRESETS } from "./dateRangePresets";
import { parseDateRangeParams, serializeDateRange } from "./dateRangeUrl";

const TODAY = "2026-10-09";
const NO_RANGE = { from: undefined, preset: undefined, to: undefined };

function parseQuery(query: string, today = TODAY) {
  return parseDateRangeParams(new URLSearchParams(query), today);
}

describe("parseDateRangeParams", () => {
  it("lee un rango personalizado válido", () => {
    expect(parseQuery("from=2026-09-03&to=2026-09-12")).toEqual({
      from: "2026-09-03",
      preset: "custom",
      to: "2026-09-12",
    });
  });

  it("sin parámetros no hay rango", () => {
    expect(parseQuery("")).toEqual(NO_RANGE);
    expect(parseQuery("search=harina&page=2")).toEqual(NO_RANGE);
  });

  it("un preset relativo sin fechas se calcula con el hoy que se le pasa", () => {
    expect(parseQuery("preset=this_month")).toEqual({
      from: "2026-10-01",
      preset: "this_month",
      to: "2026-10-09",
    });
    expect(parseQuery("preset=this_month", "2026-11-03")).toEqual({
      from: "2026-11-01",
      preset: "this_month",
      to: "2026-11-03",
    });
    expect(parseQuery("preset=last_month")).toEqual({
      from: "2026-09-01",
      preset: "last_month",
      to: "2026-09-30",
    });
  });

  it("con from y to mandan las fechas aunque el preset diga otra cosa", () => {
    expect(parseQuery("preset=this_month&from=2026-08-01&to=2026-08-15")).toEqual({
      from: "2026-08-01",
      preset: "custom",
      to: "2026-08-15",
    });
  });

  it("conserva el preset si las fechas son las de ese preset hoy", () => {
    expect(parseQuery("preset=last_month&from=2026-09-01&to=2026-09-30")).toEqual({
      from: "2026-09-01",
      preset: "last_month",
      to: "2026-09-30",
    });
  });

  it("acepta un rango abierto", () => {
    expect(parseQuery("from=2026-09-03")).toEqual({
      from: "2026-09-03",
      preset: "custom",
      to: undefined,
    });
    expect(parseQuery("to=2026-09-12")).toEqual({
      from: undefined,
      preset: "custom",
      to: "2026-09-12",
    });
  });

  it.each([
    "from=ayer&to=hoy",
    "from=2026-02-30&to=2026-13-01",
    "from=2026-9-3",
    "from=2026-09-12&to=2026-09-03",
    "preset=siempre",
    "preset=custom",
    "from=&to=&preset=",
    "from=%E0%A4%A",
  ])("descarta sin lanzar: %s", (query) => {
    expect(parseQuery(query)).toEqual(NO_RANGE);
  });

  it("una fecha mal formada no arrastra a la otra", () => {
    expect(parseQuery("from=nope&to=2026-09-12")).toEqual({
      from: undefined,
      preset: "custom",
      to: "2026-09-12",
    });
  });

  it("fechas invertidas con preset relativo: se usa el preset", () => {
    expect(parseQuery("preset=today&from=2026-09-12&to=2026-09-03")).toEqual({
      from: TODAY,
      preset: "today",
      to: TODAY,
    });
  });

  it("lee un registro como el de searchParams de una página o el estado de una lista", () => {
    expect(parseDateRangeParams({ from: "2026-09-03", preset: "", to: "2026-09-12" }, TODAY)).toEqual({
      from: "2026-09-03",
      preset: "custom",
      to: "2026-09-12",
    });
    expect(
      parseDateRangeParams({ from: ["2026-09-03", "2026-01-01"], to: undefined }, TODAY),
    ).toEqual({ from: "2026-09-03", preset: "custom", to: undefined });
    expect(parseDateRangeParams({ from: null, preset: "yesterday" }, TODAY)).toEqual({
      from: "2026-10-08",
      preset: "yesterday",
      to: "2026-10-08",
    });
    expect(parseDateRangeParams({}, TODAY)).toEqual(NO_RANGE);
  });
});

describe("serializeDateRange", () => {
  it("un preset relativo escribe solo el preset", () => {
    expect(
      serializeDateRange({ from: "2026-09-01", preset: "last_month", to: "2026-09-30" }),
    ).toEqual({ from: "", preset: "last_month", to: "" });
  });

  it("un rango personalizado escribe las fechas", () => {
    expect(serializeDateRange({ from: "2026-09-03", preset: "custom", to: "2026-09-12" })).toEqual({
      from: "2026-09-03",
      preset: "",
      to: "2026-09-12",
    });
    expect(serializeDateRange({ from: "2026-09-03" })).toEqual({
      from: "2026-09-03",
      preset: "",
      to: "",
    });
  });

  it("sin rango o con fechas inválidas no escribe nada", () => {
    const empty = { from: "", preset: "", to: "" };

    expect(serializeDateRange({})).toEqual(empty);
    expect(serializeDateRange({ from: undefined, preset: undefined, to: undefined })).toEqual(empty);
    expect(serializeDateRange({ from: "nope", to: "2026-02-30" })).toEqual(empty);
    expect(serializeDateRange({ from: "2026-09-12", to: "2026-09-03" })).toEqual(empty);
  });

  it("ida y vuelta: lo serializado se vuelve a leer igual", () => {
    const custom = { from: "2026-09-03", preset: "custom", to: "2026-09-12" } as const;
    const relative = { from: "2026-09-28", preset: "last_week", to: "2026-10-04" } as const;

    expect(parseDateRangeParams(serializeDateRange(custom), TODAY)).toEqual(custom);
    expect(parseDateRangeParams(serializeDateRange(relative), TODAY)).toEqual(relative);
    expect(parseDateRangeParams(serializeDateRange({}), TODAY)).toEqual(NO_RANGE);
  });

  it("encaja como patch de un schema de useUrlListState", () => {
    const schema = z.object({
      from: listParams.date(),
      preset: listParams.oneOf(["", ...DATE_RANGE_PRESETS], ""),
      to: listParams.date(),
    });

    expect(
      schema.parse(serializeDateRange({ from: "2026-09-03", preset: "custom", to: "2026-09-12" })),
    ).toEqual({ from: "2026-09-03", preset: "", to: "2026-09-12" });
    expect(schema.parse(serializeDateRange({ preset: "this_week" }))).toEqual({
      from: "",
      preset: "this_week",
      to: "",
    });
    expect(parseDateRangeParams(schema.parse({}), TODAY)).toEqual(NO_RANGE);
  });
});
