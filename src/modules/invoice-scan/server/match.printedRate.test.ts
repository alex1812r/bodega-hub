/**
 * SCN-UI-Q2 (QA final MEDIO-4): Gemini leyó como tasa el total REF del pie
 * (86,75 frente a 880,12) y la revisión la ofrecía como "Tasa de la factura".
 * Una tasa impresa a más de ±25 % de la del sistema no es una tasa Bs/USD: se
 * ignora (sin `printed` ni aviso de diferencia) y se dice por qué.
 */
import { buildContext, buildExtraction } from "./__fixtures__/match/context";
import { matchInvoice } from "./match";
import { PRINTED_RATE_MAX_DEVIATION, resolveRate } from "./match/money";

describe("matchInvoice · tasa impresa implausible (SCN-UI-Q2)", () => {
  it("f04: 86,75 frente a 880,12 → se ignora con aviso propio y convierte con la del sistema", () => {
    const result = matchInvoice(buildExtraction({ printedRate: 86.75 }), buildContext({ systemRate: 880.1159 }));

    expect(result.rate).toEqual({
      system: 880.1159,
      warning: "La tasa leída (86,75) no parece una tasa Bs/USD; se ignora.",
    });
  });

  it("también hacia arriba: 1.200 frente a 900 (+33 %) se ignora", () => {
    expect(resolveRate(900, 1200).info).toEqual({
      system: 900,
      warning: "La tasa leída (1.200,00) no parece una tasa Bs/USD; se ignora.",
    });
  });

  it("borde: ±25 % justo se considera (y avisa de la diferencia); un céntimo más allá se ignora", () => {
    expect(PRINTED_RATE_MAX_DEVIATION).toBe(0.25);
    expect(resolveRate(800, 1000).info).toMatchObject({ printed: 1000, warning: "La factura trae tasa 1.000,00; hoy es 800,00." });
    expect(resolveRate(800, 600).info).toMatchObject({ printed: 600 });
    expect(resolveRate(800, 1000.01).info?.printed).toBeUndefined();
    expect(resolveRate(800, 599.99).info?.printed).toBeUndefined();
  });

  it("sin tasa del sistema se mantiene: usa la impresa con aviso, aunque parezca baja", () => {
    expect(resolveRate(undefined, 86.75)).toEqual({
      used: 86.75,
      info: {
        printed: 86.75,
        warning: "No hay tasa del día en el sistema: se usó la tasa impresa en la factura (86,75).",
      },
    });
  });
});
