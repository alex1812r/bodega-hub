import { validateProductImageFile } from "./cropImageToBlob";

describe("validateProductImageFile", () => {
  it("rejects non-image files", () => {
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });

    expect(validateProductImageFile(file)).toBe("Selecciona un archivo de imagen valido.");
  });

  it("rejects files larger than 5 MB", () => {
    const file = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.webp", {
      type: "image/webp",
    });

    expect(validateProductImageFile(file)).toBe("La imagen supera el limite de 5 MB.");
  });

  it("accepts valid image files", () => {
    const file = new File(["abc"], "photo.webp", { type: "image/webp" });

    expect(validateProductImageFile(file)).toBeNull();
  });
});
