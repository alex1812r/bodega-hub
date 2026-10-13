/**
 * @jest-environment node
 *
 * PRO-F13 · el diccionario de columnas decía que la categoría "se creará si no
 * existe", pero una fila con una categoría que no existe se rechaza.
 */
import { resolveCategoryIdByName } from "../../services/resolveCategoryIds";
import { PRODUCT_IMPORT_COLUMN_DEFINITIONS } from "./productImportColumnDefinitions";

describe("diccionario de columnas de la importación · categoria (PRO-F13)", () => {
  const category = PRODUCT_IMPORT_COLUMN_DEFINITIONS.find((item) => item.column === "categoria");

  it("dice que la categoría debe existir y que, si no, la fila no se importa", () => {
    expect(category?.description).toBe(
      "Nombre exacto de la categoría. Debe existir en Categorías; si no existe, la fila no se importa.",
    );
    expect(category?.description).not.toMatch(/se creará/i);
  });

  it("coincide con el comportamiento: una categoría que no existe es un error de la fila", () => {
    expect(resolveCategoryIdByName("No existe", [])).toMatchObject({
      error: expect.stringContaining("no existe"),
    });
  });
});
