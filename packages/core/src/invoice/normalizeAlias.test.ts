import { normalizeAlias } from "./normalizeAlias";

const NBSP = " ";

describe("normalizeAlias", () => {
  it.each([
    ["REF.MALTA 1.5 X6", "ref malta 1 5 x6"],
    ["Harina  P.A.N.  1Kg", "harina p a n 1kg"],
    ["AZÚCAR  Montalbán", "azucar montalban"],
    ["Ñame AÑEJO", "name anejo"],
    ["Pingüino çafé", "pinguino cafe"],
    ['Arroz "Mary" (tipo-A) [1/2]', "arroz mary tipo a 1 2"],
    ["a.b,c;d:e/f\\g-h_i*j#k'l", "a b c d e f g h i j k l"],
    ["  Leche\tCompleta\n\r1L  ", "leche completa 1l"],
    [`Queso${NBSP}Blanco${NBSP}${NBSP}500g`, "queso blanco 500g"],
    ["SALSA + MAYO & KÉTCHUP $2 @ 50%", "salsa mayo ketchup 2 50"],
  ])("normaliza %p -> %p", (input, expected) => {
    expect(normalizeAlias(input)).toBe(expected);
  });

  it.each([
    ["ＭＡＬＴＡ　ＰＯＬＡＲ　３５５ｍｌ", "malta polar 355ml"],
    ["Haﬁna ﬂan", "hafina flan"],
    ["ℌarina ½", "harina 1 2"],
    ["MAL​TA", "malta"],
    ["MAL‌TA PO‍LAR", "malta polar"],
    ["﻿HARINA", "harina"],
    ["HARI­NA PAN", "harina pan"],
    ["MAL⁠TA", "malta"],
  ])("pliega compatibilidad (NFKD) y quita invisibles sin partir palabras: %p -> %p", (input, expected) => {
    expect(normalizeAlias(input)).toBe(expected);
  });

  it("conserva dígitos y no interpreta decimales", () => {
    expect(normalizeAlias("1.5")).toBe("1 5");
    expect(normalizeAlias("0,75L")).toBe("0 75l");
  });

  it.each(["", "   ", "\t\n", ".,;:/\\-_*#()[]\"'", `${NBSP}—…`])(
    "devuelve cadena vacía para %p",
    (input) => {
      expect(normalizeAlias(input)).toBe("");
    },
  );

  it.each([
    "REF.MALTA 1.5 X6",
    "Harina  P.A.N.  1Kg",
    "AZÚCAR  Montalbán",
    `Queso${NBSP}Blanco\t500g`,
    "İSTANBUL Ñandú",
    "ＭＡＬＴＡ ﬁ ℌ ½ MAL​TA HARI­NA",
    "",
    "--",
  ])("es idempotente para %p", (input) => {
    const once = normalizeAlias(input);
    expect(normalizeAlias(once)).toBe(once);
  });
});
