import { stripControlChars } from "./productText";

describe("stripControlChars (PRO-F10 · M6)", () => {
  it("removes NUL and the other non printable control characters", () => {
    expect(stripControlChars("Hari\u0000na\u0007 PAN\u001f\u007f\u0085")).toBe("Harina PAN");
  });

  it("keeps accents, ñ, emoji, tabs and line breaks", () => {
    const text = "Piñón añejo 🍕👨‍👩‍👧\tcafé\r\nsegunda línea";

    expect(stripControlChars(text)).toBe(text);
  });
});
