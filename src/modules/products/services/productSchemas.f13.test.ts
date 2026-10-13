/**
 * @jest-environment node
 *
 * PRO-F13 · la descripción del producto viaja en el alta y en la edición:
 * saneada, `null` si queda vacía y con un máximo de 500 caracteres.
 */
import {
  buildProductCreateFingerprint,
  createProductSchema,
  PRODUCT_DESCRIPTION_MAX_LENGTH,
  updateProductSchema,
} from "./productSchemas";

const base = { name: "Harina", salePriceRef: 2 };

describe("productSchemas · descripción (PRO-F13)", () => {
  it("el alta acepta la descripción, sin espacios sobrantes ni caracteres de control", () => {
    expect(
      createProductSchema.parse({ ...base, description: "  Harina\u0000 de trigo\n1 kg  " }),
    ).toMatchObject({ description: "Harina de trigo\n1 kg" });
  });

  it("vacía, en blanco o `null` queda `null`; ausente no viaja", () => {
    expect(createProductSchema.parse({ ...base, description: "   " }).description).toBeNull();
    expect(createProductSchema.parse({ ...base, description: null }).description).toBeNull();
    expect(createProductSchema.parse(base).description).toBeUndefined();
    expect(updateProductSchema.parse({ description: "" }).description).toBeNull();
    expect(updateProductSchema.parse({ name: "Harina" }).description).toBeUndefined();
  });

  it("la edición acepta el cambio de descripción", () => {
    expect(updateProductSchema.parse({ description: " Nueva " })).toMatchObject({
      description: "Nueva",
    });
  });

  it("más de 500 caracteres se rechaza en el alta y en la edición", () => {
    const limit = "a".repeat(PRODUCT_DESCRIPTION_MAX_LENGTH);

    expect(PRODUCT_DESCRIPTION_MAX_LENGTH).toBe(500);
    expect(createProductSchema.parse({ ...base, description: limit }).description).toBe(limit);
    expect(createProductSchema.safeParse({ ...base, description: `${limit}a` }).success).toBe(false);
    expect(updateProductSchema.safeParse({ description: `${limit}a` }).success).toBe(false);
  });

  it("la huella del alta incluye la descripción: mismo cuerpo, misma huella", () => {
    const fingerprint = (body: Record<string, unknown>) =>
      buildProductCreateFingerprint(createProductSchema.parse(body));

    expect(fingerprint({ ...base, description: " Fina " })).toBe(
      fingerprint({ description: "Fina", ...base }),
    );
    expect(fingerprint({ ...base, description: "Fina" })).not.toBe(
      fingerprint({ ...base, description: "Otra" }),
    );
    expect(fingerprint({ ...base, description: "Fina" })).not.toBe(fingerprint(base));
  });
});
