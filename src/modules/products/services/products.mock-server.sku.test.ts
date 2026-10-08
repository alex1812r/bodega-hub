/**
 * @jest-environment node
 */
/** PRO-05 · paridad del mock con `products.server.sku.test.ts`. */

import { ApiError } from "@/lib/api/apiError";
import { mockProducts } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { GENERATED_SKU_MAX_ATTEMPTS } from "./productSku";
import { createProduct, updateProduct } from "./products.mock-server";

const initialLength = mockProducts.length;

/**
 * SKU con el que quedó guardada el alta. Se lee del catálogo y no del retorno:
 * el id del mock sale de `Date.now()` y dos altas en el mismo milisegundo lo comparten.
 */
function createAndReadSku(input: Parameters<typeof createProduct>[0]) {
  createProduct(input, DEFAULT_STORE_ID);

  return mockProducts[mockProducts.length - 1]?.sku;
}

afterEach(() => {
  mockProducts.length = initialLength;
  jest.restoreAllMocks();
});

describe("products.mock-server createProduct: sku generado (PRO-05)", () => {
  it.each([{ sku: undefined }, { sku: "" }, { sku: "   " }])(
    "sin SKU ($sku) lo deriva del nombre, sin tildes ni ñ",
    ({ sku }) => {
      const created = createProduct(
        { name: "Piñón Añejo Café", salePriceRef: 2, sku },
        DEFAULT_STORE_ID,
      );

      expect(created.sku).toBe("pino-anej-cafe");
      expect(created.storeId).toBe(DEFAULT_STORE_ID);
    },
  );

  it("respeta el SKU escrito, normalizado", () => {
    expect(
      createProduct({ name: "Harina PAN", salePriceRef: 2, sku: "  MI-SKU " }, DEFAULT_STORE_ID).sku,
    ).toBe("mi-sku");
  });

  it("si el SKU generado choca, cada alta recibe uno distinto con sufijo", () => {
    const first = createAndReadSku({ name: "Harina PAN", salePriceRef: 2 });
    const second = createAndReadSku({ name: "Harina PAN", salePriceRef: 2 });
    const third = createAndReadSku({ name: "Harina PAN", salePriceRef: 2 });

    expect(first).toBe("hari-pan");
    expect(second).toMatch(/^hari-pan-[0-9a-f]{4}$/);
    expect(third).toMatch(/^hari-pan-[0-9a-f]{4}$/);
    expect(new Set([first, second, third]).size).toBe(3);
  });

  it("el reintento es acotado: agotado responde 409 y no crea el producto", () => {
    // Sufijo fijo: tras ocupar el SKU del nombre y el del sufijo, todo intento choca.
    const randomUuid = jest
      .spyOn(crypto, "randomUUID")
      .mockReturnValue("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");

    expect(createAndReadSku({ name: "Harina PAN", salePriceRef: 2 })).toBe("hari-pan");
    expect(createAndReadSku({ name: "Harina PAN", salePriceRef: 2 })).toBe("hari-pan-aaaa");
    randomUuid.mockClear();

    expect(() => createProduct({ name: "Harina PAN", salePriceRef: 2 }, DEFAULT_STORE_ID)).toThrow(
      new ApiError(
        409,
        "CONFLICT",
        "No se pudo generar un SKU único para este producto. Escribe uno e intenta de nuevo.",
      ),
    );
    expect(randomUuid).toHaveBeenCalledTimes(GENERATED_SKU_MAX_ATTEMPTS - 1);
    expect(mockProducts).toHaveLength(initialLength + 2);
  });

  it("un SKU escrito que ya existe no se cambia: 409", () => {
    expect(() =>
      createProduct({ name: "Taladro", salePriceRef: 2, sku: "HER-TAL-001" }, DEFAULT_STORE_ID),
    ).toThrow("Ya existe un producto con este SKU.");
  });

  it.each(["🍕🍕", "***", "---"])(
    "un nombre sin letras ni dígitos (%s) recibe un SKU de respaldo válido",
    (name) => {
      expect(createAndReadSku({ name, salePriceRef: 2 })).toBe("producto");
      expect(createAndReadSku({ name, salePriceRef: 2 })).toMatch(/^producto-[0-9a-f]{4}$/);
    },
  );
});

describe("products.mock-server updateProduct: sku vacío (PRO-05)", () => {
  it.each([{ sku: undefined }, { sku: "" }, { sku: "  " }])(
    "con SKU vacío ($sku) se conserva el actual",
    ({ sku }) => {
      const created = createProduct(
        { name: "Harina PAN", salePriceRef: 2, sku: "pro05-edit" },
        DEFAULT_STORE_ID,
      );

      const updated = updateProduct(created.id, { name: "Harina PAN 1kg", sku }, DEFAULT_STORE_ID);

      expect(updated.name).toBe("Harina PAN 1kg");
      expect(updated.sku).toBe("pro05-edit");
    },
  );

  it("con SKU escrito lo actualiza normalizado", () => {
    const created = createProduct(
      { name: "Harina PAN", salePriceRef: 2, sku: "pro05-edit" },
      DEFAULT_STORE_ID,
    );

    expect(updateProduct(created.id, { sku: " NUEVO-01 " }, DEFAULT_STORE_ID).sku).toBe("nuevo-01");
  });
});
