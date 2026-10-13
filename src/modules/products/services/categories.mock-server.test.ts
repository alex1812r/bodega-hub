import { ApiError } from "@/lib/api/apiError";
import { mockCategories } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import {
  createCategory,
  deleteCategory,
  getCategoryById,
  listCategories,
  updateCategory,
} from "./categories.mock-server";

/** PRO-F3 · paridad del mock de categorías con `categories.server.ts`. */

const OTHER_STORE_ID = "00000000-0000-4000-8000-000000000002";
const DUPLICATE = { code: "CONFLICT", message: "El recurso ya existe.", status: 409 };

function listNames(storeId = DEFAULT_STORE_ID, query = "isActive=all&limit=100") {
  return listCategories(new URLSearchParams(query), storeId).items.map((item) => item.name);
}

function captureApiError(run: () => unknown) {
  try {
    run();
  } catch (error) {
    if (error instanceof ApiError) {
      return { code: error.code, message: error.message, status: error.status };
    }

    throw error;
  }

  return null;
}

describe("categories.mock-server", () => {
  let seed: typeof mockCategories;

  beforeEach(() => {
    seed = mockCategories.map((category) => ({ ...category }));
  });

  afterEach(() => {
    mockCategories.splice(0, mockCategories.length, ...seed);
  });

  it("la categoría creada queda guardada: sale en el detalle y en la lista", () => {
    const created = createCategory({ name: "Jardinería", taxRate: 8 }, DEFAULT_STORE_ID);

    expect(getCategoryById(created.id, DEFAULT_STORE_ID)).toMatchObject({
      isActive: true,
      name: "Jardinería",
      taxRate: 8,
      taxRateId: "tax-reducida",
    });
    expect(listNames(DEFAULT_STORE_ID, "limit=100")).toContain("Jardinería");
    expect(listNames(OTHER_STORE_ID)).not.toContain("Jardinería");
  });

  it("dos altas seguidas no comparten id", () => {
    const first = createCategory({ name: "Jardinería" }, DEFAULT_STORE_ID);
    const second = createCategory({ name: "Plomería fina" }, DEFAULT_STORE_ID);

    expect(second.id).not.toBe(first.id);
    expect(getCategoryById(second.id, DEFAULT_STORE_ID).name).toBe("Plomería fina");
  });

  it("un alta rechazada por la alícuota no deja nada guardado", () => {
    const before = mockCategories.length;

    expect(captureApiError(() => createCategory({ name: "Lujo", taxRate: 13 }, DEFAULT_STORE_ID)))
      .toMatchObject({ status: 400 });
    expect(mockCategories).toHaveLength(before);
  });

  it("rechaza con 409 un nombre que ya usa otra categoría activa de la tienda", () => {
    const before = mockCategories.length;

    expect(captureApiError(() => createCategory({ name: "Pintura" }, DEFAULT_STORE_ID))).toEqual(
      DUPLICATE,
    );
    expect(mockCategories).toHaveLength(before);

    createCategory({ name: "Jardinería" }, DEFAULT_STORE_ID);

    expect(captureApiError(() => createCategory({ name: "Jardinería" }, DEFAULT_STORE_ID))).toEqual(
      DUPLICATE,
    );
  });

  it("como el índice único real: compara el nombre exacto, por tienda y solo entre activas", () => {
    // Distinta capitalización o espacios: otro nombre para el índice (store_id, name).
    expect(createCategory({ name: "pintura" }, DEFAULT_STORE_ID).name).toBe("pintura");
    expect(createCategory({ name: " Pintura " }, DEFAULT_STORE_ID).name).toBe(" Pintura ");
    // Otra tienda.
    expect(createCategory({ name: "Pintura" }, OTHER_STORE_ID).storeId).toBe(OTHER_STORE_ID);
    // Una inactiva no ocupa el nombre.
    deleteCategory("cat-paint", DEFAULT_STORE_ID);
    expect(createCategory({ name: "Pintura" }, DEFAULT_STORE_ID).isActive).toBe(true);
  });

  it("editar: renombrar a un nombre activo ya usado da 409 y no cambia nada", () => {
    expect(
      captureApiError(() =>
        updateCategory("cat-tools", { description: "Otra", name: "Pintura" }, DEFAULT_STORE_ID),
      ),
    ).toEqual(DUPLICATE);
    expect(getCategoryById("cat-tools", DEFAULT_STORE_ID)).toMatchObject({
      description: "Herramientas manuales y electricas",
      name: "Herramientas",
    });

    // Guardar la misma categoría con su propio nombre no choca consigo misma.
    expect(
      updateCategory("cat-tools", { name: "Herramientas", taxRate: 8 }, DEFAULT_STORE_ID),
    ).toMatchObject({ name: "Herramientas", taxRate: 8 });
  });

  it("reactivar una categoría cuyo nombre ya tomó otra activa da 409", () => {
    deleteCategory("cat-paint", DEFAULT_STORE_ID);
    createCategory({ name: "Pintura" }, DEFAULT_STORE_ID);

    expect(
      captureApiError(() => updateCategory("cat-paint", { isActive: true }, DEFAULT_STORE_ID)),
    ).toEqual(DUPLICATE);
    expect(getCategoryById("cat-paint", DEFAULT_STORE_ID).isActive).toBe(false);
  });

  it("editar y desactivar una categoría creada se conservan", () => {
    const created = createCategory({ name: "Jardinería" }, DEFAULT_STORE_ID);

    updateCategory(created.id, { description: "Plantas", name: "Jardín" }, DEFAULT_STORE_ID);
    expect(getCategoryById(created.id, DEFAULT_STORE_ID)).toMatchObject({
      description: "Plantas",
      name: "Jardín",
    });

    expect(deleteCategory(created.id, DEFAULT_STORE_ID)).toMatchObject({ deleted: true });
    expect(getCategoryById(created.id, DEFAULT_STORE_ID).isActive).toBe(false);
    expect(listNames(DEFAULT_STORE_ID, "limit=100")).not.toContain("Jardín");
    expect(listNames()).toContain("Jardín");
  });
});
