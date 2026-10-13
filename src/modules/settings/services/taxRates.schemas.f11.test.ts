/**
 * PRO-F11 · un NUL en el nombre de la alícuota llegaba a Postgres y salía como
 * 500 ("unsupported Unicode escape sequence").
 */
import { createTaxRateSchema, updateTaxRateSchema } from "./taxRates.schemas";

const NUL = "\u0000";

describe("taxRates.schemas · caracteres de control en el nombre (PRO-F11)", () => {
  it("quita el NUL del nombre al crear", () => {
    expect(createTaxRateSchema.parse({ label: `Gene${NUL}ral 12 % `, pct: 12 }).label).toBe(
      "General 12 %",
    );
  });

  it("quita el NUL del nombre al editar", () => {
    expect(updateTaxRateSchema.parse({ label: `${NUL}Reducida` }).label).toBe("Reducida");
  });

  it("rechaza un nombre que solo trae caracteres de control", () => {
    expect(createTaxRateSchema.safeParse({ label: `${NUL}${NUL}`, pct: 12 }).success).toBe(false);
  });

  it("sigue rechazando un nombre de más de 60 caracteres", () => {
    expect(createTaxRateSchema.safeParse({ label: "a".repeat(61), pct: 12 }).success).toBe(false);
  });
});
