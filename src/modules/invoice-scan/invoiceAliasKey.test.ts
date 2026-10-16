import { invoiceAliasKey, stableRawText } from "./invoiceAliasKey";
import { normalizeAlias } from "@bodega/core/invoice";

describe("stableRawText", () => {
  it.each([
    // Dos lecturas de la misma línea (Gemini, QA final f02/f03): misma clave.
    ["POWER MAX 400ML\n1,00 x 4.358,64\n[CAJA X 15,00]", "power max 400ml caja"],
    ["POWER MAX 400ML 1,00 x 4.358,64 Bs 4.358,64 [CAJA X 15,00]", "power max 400ml caja"],
    ["GLUP COLA 2L 1,00 x 5.173,34 Bs 5.173,34 [BULTO X 6,00]", "glup cola 2l bulto"],
    // Tamaños de presentación pegados se conservan.
    ["HARINA PAN 1KG X20 2,00 x 9.631,20", "harina pan 1kg x20"],
    ["ARROZ 500G 12,00 REF 1,25", "arroz 500g"],
    ["MALTA 1.5L [BULTO X 6] 4.203,12", "malta 1 5l bulto 6"],
    // Números sin formato de dinero se conservan (pueden ser tamaño).
    ["JUSTY 1,5 2,00 x 9.570,85", "justy 1 5"],
    ["AGUA 5 LITROS", "agua 5 litros"],
    // Monedas y signos sueltos fuera; miles sin decimales también.
    ["ACEITE 1L $ 1.000 USD 12.50", "aceite 1l"],
    ["QUESO × 3.500,00 bs.", "queso"],
  ])("%p -> %p", (rawText, expected) => {
    expect(stableRawText(rawText)).toBe(expected);
  });

  it("solo números y moneda: vacío", () => {
    expect(stableRawText("1,00 x 4.358,64 Bs 4.358,64")).toBe("");
  });

  it("la salida está en forma canónica de normalizeAlias", () => {
    const key = stableRawText("  Café  ÑOÑO 250G (E) 3,00 x 1.234,56 ");
    expect(normalizeAlias(key)).toBe(key);
    expect(key).toBe("cafe nono 250g e");
  });
});

describe("invoiceAliasKey", () => {
  it("con descripción útil: la descripción normalizada, sin mirar el rawText", () => {
    expect(invoiceAliasKey({ rawText: "GLUP COLA 2L 1,00 x 5.173,34 Bs 5.173,34", description: "GLUP COLA 2L" })).toBe("glup cola 2l");
    expect(invoiceAliasKey({ rawText: "JUSTY 1,5 2,00 x 9.570,85", description: "JUSTY 1,5" })).toBe("justy 1 5");
  });

  it.each([undefined, null, "", "   ", "12,00", "-"])("descripción %p sin letras: rawText estable", (description) => {
    expect(invoiceAliasKey({ rawText: "POWER MAX 400ML 1,00 x 4.358,64 [CAJA X 15,00]", description })).toBe(
      "power max 400ml caja",
    );
  });

  it("es idempotente sobre su salida", () => {
    const key = invoiceAliasKey({ rawText: "x", description: "Harina P.A.N. 1Kg" });
    expect(invoiceAliasKey({ rawText: key, description: key })).toBe(key);
  });
});
