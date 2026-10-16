/**
 * SCN-11-it1 · Textos alternativos de búsqueda difusa: el empaque, los prefijos
 * y las unidades pegadas al número dejaban sin candidato a líneas cuyo producto
 * existe ("JUSTY 400ML [BULTO X 15,00]" -> "Justy pequeño 400 ml").
 */
import { searchTextVariants } from "./match/searchText";

describe("searchTextVariants", () => {
  it("separa la unidad del número y quita el marcador de empaque entre corchetes", () => {
    const variants = searchTextVariants({ rawText: "JUSTY 400ML [BULTO X 15,00]", description: "Justy 400ml" });
    expect(variants).toContain("justy 400 ml");
    expect(variants.some((text) => /bulto|15/.test(text))).toBe(false);
  });

  it("quita [MAYOR], #[1x3] # y la marca de alícuota (E)", () => {
    const variants = searchTextVariants({ rawText: "[MAYOR] HARINA PAN 1KG(E) #[1x3] #", description: "Harina PAN 1kg" });
    // "harina pan 1kg" limpio = la description que ya se mandó: no se repite.
    expect(variants).toEqual(["harina pan 1 kg"]);
    expect(variants.some((text) => /mayor|1x3|\be\b/.test(text))).toBe(false);
  });

  it("quita |[DOC X 12.0]| y palabras de empaque sueltas con su tamaño", () => {
    expect(
      searchTextVariants({
        rawText: "CREMA D. COLGATE TRIPLE ACCION 60 CC |[DOC X 12.0]|",
        description: "Crema dental Colgate Triple Acción 60cc",
      }),
    ).toContain("crema d colgate triple accion 60 cc");
    expect(searchTextVariants({ rawText: "Harina Pan bulto x20", description: "Harina PAN 1kg" })).toContain(
      "harina pan 1 kg",
    );
    expect(
      searchTextVariants({ rawText: "CHEESE TRIS 12X50GR. TIRA", description: "Cheese Tris 50g (tira x12)" }),
    ).toContain("cheese tris 50g");
  });

  it("quita el tamaño de empaque NxM, *N UND y N U", () => {
    expect(searchTextVariants({ rawText: "MALPORT T 6X1.75", description: "Malport T 6x1.75L" })).toContain(
      "malport t 1 75 l",
    );
    expect(searchTextVariants({ rawText: "SAMY 264G*24UND", description: "Samy 264g x24" })).toContain("samy 264g");
    expect(
      searchTextVariants({
        rawText: "CARAMELOS MENTA HELADA SUPER 380GRS 100U",
        description: "Caramelos menta helada Super 380g (100 u)",
      }),
    ).toContain("caramelos menta helada super 380g");
  });

  it("quita (P) y el relleno EN", () => {
    expect(
      searchTextVariants({ rawText: "CERVEZA SOLERA AZUL LIGHT EN 222ML (P)", description: "" }),
    ).toContain("cerveza solera azul light 222ml");
  });

  it("no repite los textos que ya se mandan ni corta palabras que contienen una de empaque", () => {
    expect(searchTextVariants({ rawText: "MALTA POLAR", description: "Malta Polar" })).toEqual([]);
    const variants = searchTextVariants({ rawText: "CAFE CAJAMARCA", description: "Café Cajamarca" });
    expect(variants).toEqual([]);
  });
});
