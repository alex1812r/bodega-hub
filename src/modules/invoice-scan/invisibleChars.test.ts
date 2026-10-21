import { hasInvisibleChar, replaceInvisibleChars } from "./invisibleChars";

/** Un carácter por extremo de cada rango vetado (REP2-03b, REP3-03b caos N8 / auditoría B16). */
const INVISIBLES: [string, string][] = [
  ["U+00AD", "\u00ad"],
  ["U+034F", "\u034f"],
  ["U+061C", "\u061c"],
  ["U+115F", "\u115f"],
  ["U+1160", "\u1160"],
  ["U+17B4", "\u17b4"],
  ["U+17B5", "\u17b5"],
  ["U+180E", "\u180e"],
  ["U+200B", "\u200b"],
  ["U+200C", "\u200c"],
  ["U+200D suelto", "\u200d"],
  ["U+200E", "\u200e"],
  ["U+200F", "\u200f"],
  ["U+2028", "\u2028"],
  ["U+2029", "\u2029"],
  ["U+202A", "\u202a"],
  ["U+202E", "\u202e"],
  ["U+2060", "\u2060"],
  ["U+2061", "\u2061"],
  ["U+2064", "\u2064"],
  ["U+2066", "\u2066"],
  ["U+2069", "\u2069"],
  ["U+206A", "\u206a"],
  ["U+206F", "\u206f"],
  ["U+2800", "\u2800"],
  ["U+3164", "\u3164"],
  ["U+FE00", "\ufe00"],
  ["U+FE0D", "\ufe0d"],
  ["U+FE0E suelto", "\ufe0e"],
  ["U+FE0F suelto", "\ufe0f"],
  ["U+FEFF", "\ufeff"],
  ["U+FFA0", "\uffa0"],
  ["U+FFF9", "\ufff9"],
  ["U+FFFB", "\ufffb"],
  ["U+1D173", "\u{1d173}"],
  ["U+1D17A", "\u{1d17a}"],
  ["U+E0000", "\u{e0000}"],
  ["U+E007F", "\u{e007f}"],
  ["U+E0100", "\u{e0100}"],
  ["U+E01EF", "\u{e01ef}"],
];

describe("invisibleChars · lista única de invisibles", () => {
  it.each(INVISIBLES)("veta %s y lo quita del texto", (_name, char) => {
    expect(hasInvisibleChar(`AVILA${char}X`)).toBe(true);
    expect(hasInvisibleChar(replaceInvisibleChars(`AVILA${char}X`))).toBe(false);
  });

  it("U+2028/U+2029 pasan a salto de línea; el reemplazo es configurable", () => {
    expect(replaceInvisibleChars("A\u2028B\u2029C")).toBe("A\nB\nC");
    expect(replaceInvisibleChars("A\u200bB\u{e0041}C", " ")).toBe("A B C");
  });

  it.each([
    ["emoji simple", "AVILA \u{1f600}"],
    ["familia con U+200D", "\u{1f468}\u200d\u{1f469}\u200d\u{1f467}"],
    ["corazón con U+FE0F y U+200D", "\u2764\ufe0f\u200d\u{1f525}"],
    ["tono de piel con U+200D", "\u{1f469}\u{1f3fd}\u200d\u{1f4bb}"],
    ["keycap", "1\ufe0f\u20e3"],
    ["hangul normal", "한국 식품 ㄱㅏ"],
    ["acentos y ñ", "Panadería Ñandú, C.A."],
  ])("deja pasar %s", (_name, text) => {
    expect(hasInvisibleChar(text)).toBe(false);
    expect(replaceInvisibleChars(text)).toBe(text);
  });
});
