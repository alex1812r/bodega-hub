import { hasInvisibleChar, replaceInvisibleChars } from "./invisibleChars";
import { sanitizeFewShotText } from "./server/fewShot";

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

/** REP4-02a (caos p4 N8r / auditoría p5 B16): residuo que la lista dejaba pasar. */
const RESIDUE = [
  0x180b, 0x180c, 0x180d, 0x180f, 0x1bca0, 0x1bca1, 0x1bca2, 0x1bca3, 0x0600, 0x0601, 0x0602, 0x0603, 0x0604, 0x0605,
  0x06dd, 0x070f, 0x0890, 0x0891, 0x08e2, 0x110bd, 0x110cd, 0x13430, 0x13438, 0x1343f,
];

const hex = (cp: number) => `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;

describe("invisibleChars · veto por propiedades Unicode (REP4-02a)", () => {
  it.each(RESIDUE.map((cp): [string, number] => [hex(cp), cp]))("veta %s del residuo y lo quita", (_name, cp) => {
    const text = `HARINA${String.fromCodePoint(cp)}PAN`;

    expect(hasInvisibleChar(text)).toBe(true);
    expect(replaceInvisibleChars(text)).toBe("HARINAPAN");
  });

  it("veta todo Cf ∪ Default_Ignorable asignado; fuera de un emoji no hay excepción", () => {
    const passing: string[] = [];
    const surviving: string[] = [];
    let total = 0;

    for (let cp = 0; cp <= 0x10ffff; cp += 1) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const char = String.fromCodePoint(cp);

      if (!/\p{Assigned}/u.test(char) || !/[\p{Cf}\p{Default_Ignorable_Code_Point}]/u.test(char)) continue;
      total += 1;
      const text = `HARINA${char}PAN`;

      if (!hasInvisibleChar(text)) passing.push(hex(cp));
      if (hasInvisibleChar(replaceInvisibleChars(text)) || hasInvisibleChar(sanitizeFewShotText(text))) {
        surviving.push(hex(cp));
      }
    }

    expect(total).toBeGreaterThan(400);
    expect(passing).toEqual([]);
    expect(surviving).toEqual([]);
  });

  it("veto y saneo coinciden en todo Unicode asignado: lo que no se veta, el saneo no lo toca", () => {
    const mismatched: string[] = [];

    for (let cp = 0x20; cp <= 0x10ffff; cp += 1) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const char = String.fromCodePoint(cp);

      if (!/\p{Assigned}/u.test(char)) continue;
      const text = `A${char}B`;
      const vetoed = hasInvisibleChar(text);
      const changed = replaceInvisibleChars(text) !== text;

      if (vetoed !== changed) mismatched.push(hex(cp));
    }

    expect(mismatched).toEqual([]);
  });
});
