/**
 * @jest-environment node
 */
/** COM-F9 · proveedores para compras en el mock: misma fuente que el mock de contactos. */

import { createContact, updateContact } from "@/modules/contacts/services/contacts.mock-server";
import { mockContacts } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { getPurchaseSupplierById, listPurchaseSuppliers } from "./purchaseSuppliers.mock-server";

const OTHER_STORE_ID = "00000000-0000-4000-8000-0000000000ff";

describe("purchaseSuppliers.mock-server", () => {
  const initialLength = mockContacts.length;

  afterEach(() => {
    mockContacts.splice(initialLength);
  });

  it("lista proveedores y ambos activos, por nombre, con solo los campos mínimos", () => {
    const page = listPurchaseSuppliers({ limit: 20, skip: 0 }, DEFAULT_STORE_ID);
    const expected = mockContacts
      .filter(
        (contact) =>
          contact.isActive &&
          contact.type !== "cliente" &&
          (contact.storeId ?? DEFAULT_STORE_ID) === DEFAULT_STORE_ID,
      )
      .map((contact) => contact.name)
      .sort((first, second) => first.localeCompare(second));

    expect(page.items.map((supplier) => supplier.name)).toEqual(expected);
    expect(page.total).toBe(expected.length);
    expect(page.items.every((supplier) => supplier.isActive)).toBe(true);

    for (const supplier of page.items) {
      expect(Object.keys(supplier).sort()).toEqual(["id", "isActive", "name", "taxId"]);
    }
  });

  it("lee los contactos del mock de contactos: uno creado o desactivado allí se refleja aquí", () => {
    const created = createContact(
      { name: "Proveedor Recien Creado F9", taxId: "J-55555555-5", type: "proveedor" },
      DEFAULT_STORE_ID,
    );
    const search = { limit: 8, search: "recien creado f9", skip: 0 };

    expect(listPurchaseSuppliers(search, DEFAULT_STORE_ID).items).toEqual([
      { id: created.id, isActive: true, name: "Proveedor Recien Creado F9", taxId: "J-55555555-5" },
    ]);
    expect(
      listPurchaseSuppliers({ limit: 8, search: "j-55555555", skip: 0 }, DEFAULT_STORE_ID).total,
    ).toBe(1);

    updateContact(created.id, { isActive: false }, DEFAULT_STORE_ID);

    expect(listPurchaseSuppliers(search, DEFAULT_STORE_ID).items).toEqual([]);
    expect(getPurchaseSupplierById(created.id, DEFAULT_STORE_ID)).toEqual({
      id: created.id,
      isActive: false,
      name: "Proveedor Recien Creado F9",
      taxId: "J-55555555-5",
    });
  });

  it("pagina con skip y limit", () => {
    const all = listPurchaseSuppliers({ limit: 20, skip: 0 }, DEFAULT_STORE_ID);
    const page = listPurchaseSuppliers({ limit: 1, skip: 1 }, DEFAULT_STORE_ID);

    expect(all.items.length).toBeGreaterThan(1);
    expect(page).toEqual({ items: [all.items[1]], limit: 1, skip: 1, total: all.total });
  });

  it("no entrega clientes ni contactos de otra tienda", () => {
    const foreign = createContact({ name: "Proveedor Ajeno F9", type: "proveedor" }, OTHER_STORE_ID);

    expect(
      listPurchaseSuppliers({ limit: 8, search: "ajeno f9", skip: 0 }, DEFAULT_STORE_ID).items,
    ).toEqual([]);
    expect(() => getPurchaseSupplierById(foreign.id, DEFAULT_STORE_ID)).toThrow(
      "Proveedor no encontrado.",
    );
    expect(() => getPurchaseSupplierById("cont-customer", DEFAULT_STORE_ID)).toThrow(
      "Proveedor no encontrado.",
    );
    expect(() => getPurchaseSupplierById("no-existe", DEFAULT_STORE_ID)).toThrow(
      "Proveedor no encontrado.",
    );
  });
});
