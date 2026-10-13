/**
 * REP-F8 · R-14: un rango de la URL que no se puede usar (invertido, con el año
 * fuera de 2000–año en curso + 1, o mal formado) se descarta entero y se avisa.
 */
import { isUsableUrlDate, sanitizeUrlRange } from "./urlDateRange";

const TODAY = "2026-05-18";

describe("isUsableUrlDate", () => {
  it("acepta fechas reales entre 2000 y el año siguiente al actual", () => {
    expect(isUsableUrlDate("2000-01-01", TODAY)).toBe(true);
    expect(isUsableUrlDate("2026-05-18", TODAY)).toBe(true);
    expect(isUsableUrlDate("2027-12-31", TODAY)).toBe(true);
  });

  it("rechaza años fuera de rango y fechas que no existen", () => {
    expect(isUsableUrlDate("1999-12-31", TODAY)).toBe(false);
    expect(isUsableUrlDate("2028-01-01", TODAY)).toBe(false);
    expect(isUsableUrlDate("9999-12-31", TODAY)).toBe(false);
    expect(isUsableUrlDate("2026-02-30", TODAY)).toBe(false);
    expect(isUsableUrlDate("ayer", TODAY)).toBe(false);
  });
});

describe("sanitizeUrlRange", () => {
  const url = (from: string | null, to: string | null) => ({ from, to });

  it("deja pasar un rango válido, completo o abierto", () => {
    expect(
      sanitizeUrlRange({ from: "2026-05-01", to: "2026-05-10" }, url("2026-05-01", "2026-05-10"), TODAY),
    ).toEqual({ from: "2026-05-01", to: "2026-05-10", wasInvalid: false });
    expect(sanitizeUrlRange({ from: "2026-05-01", to: "" }, url("2026-05-01", null), TODAY)).toEqual({
      from: "2026-05-01",
      to: "",
      wasInvalid: false,
    });
    expect(sanitizeUrlRange({ from: "", to: "" }, url(null, null), TODAY)).toEqual({
      from: "",
      to: "",
      wasInvalid: false,
    });
  });

  it("rango invertido: se descartan las dos fechas", () => {
    expect(
      sanitizeUrlRange({ from: "2026-05-10", to: "2026-05-01" }, url("2026-05-10", "2026-05-01"), TODAY),
    ).toEqual({ from: "", to: "", wasInvalid: true });
  });

  it.each([
    ["9999-12-31 como fin", "2026-05-01", "9999-12-31"],
    ["1900 como inicio", "1900-01-01", "2026-05-10"],
  ])("año fuera de rango (%s): se descartan las dos fechas", (_name, from, to) => {
    expect(sanitizeUrlRange({ from, to }, url(from, to), TODAY)).toEqual({
      from: "",
      to: "",
      wasInvalid: true,
    });
  });

  it("fecha mal formada (el estado ya la descartó): se descarta también la otra", () => {
    expect(sanitizeUrlRange({ from: "", to: "2026-05-10" }, url("ayer", "2026-05-10"), TODAY)).toEqual({
      from: "",
      to: "",
      wasInvalid: true,
    });
    expect(sanitizeUrlRange({ from: "2026-05-01", to: "" }, url("2026-05-01", "2026-13-45"), TODAY)).toEqual({
      from: "",
      to: "",
      wasInvalid: true,
    });
  });

  it("no confunde con inválido el instante en que el estado va por delante de la URL", () => {
    // El usuario quitó el rango: el estado ya está vacío y la URL aún trae el anterior.
    expect(sanitizeUrlRange({ from: "", to: "" }, url("2026-05-01", "2026-05-10"), TODAY)).toEqual({
      from: "",
      to: "",
      wasInvalid: false,
    });
    // El usuario eligió un rango nuevo sobre una URL mal formada.
    expect(
      sanitizeUrlRange({ from: "2026-05-01", to: "2026-05-10" }, url("ayer", "mañana"), TODAY),
    ).toEqual({ from: "2026-05-01", to: "2026-05-10", wasInvalid: false });
  });
});
