import { mockContacts } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { createContact, getContactById, listContacts, updateContact } from "./contacts.mock-server";

/** PRO-F3 · el mock de contactos guarda lo que crea y lo que edita. */

function listNames(query = "limit=100") {
  return listContacts(new URLSearchParams(query), DEFAULT_STORE_ID).items.map((item) => item.name);
}

describe("contacts.mock-server", () => {
  let seed: typeof mockContacts;

  beforeEach(() => {
    seed = mockContacts.map((contact) => ({ ...contact }));
  });

  afterEach(() => {
    mockContacts.splice(0, mockContacts.length, ...seed);
  });

  it("el contacto creado queda guardado: sale en el detalle y en la lista", () => {
    const created = createContact(
      { name: "Distribuidora Polar", taxId: "J-99999999-9", type: "proveedor" },
      DEFAULT_STORE_ID,
    );

    expect(getContactById(created.id, DEFAULT_STORE_ID)).toMatchObject({
      isActive: true,
      name: "Distribuidora Polar",
      taxId: "J-99999999-9",
      type: "proveedor",
    });
    expect(listNames()).toContain("Distribuidora Polar");
    expect(listNames("type=proveedor&limit=100")).toContain("Distribuidora Polar");
  });

  it("sin correo, teléfono, RIF ni dirección los guarda vacíos, como el servidor", () => {
    const first = createContact({ name: "Sin datos" }, DEFAULT_STORE_ID);
    const second = createContact({ name: "Sin datos dos" }, DEFAULT_STORE_ID);

    expect(getContactById(first.id, DEFAULT_STORE_ID)).toMatchObject({
      address: "",
      email: "",
      phone: "",
      taxId: "",
      type: "cliente",
    });
    expect(second.id).not.toBe(first.id);
    expect(getContactById(second.id, DEFAULT_STORE_ID).name).toBe("Sin datos dos");
  });

  it("un alta rechazada por RIF repetido no deja nada guardado", () => {
    createContact({ name: "Distribuidora Polar", taxId: "J-99999999-9" }, DEFAULT_STORE_ID);

    const before = mockContacts.length;

    expect(() =>
      createContact({ name: "Otra Polar", taxId: "J-99999999-9" }, DEFAULT_STORE_ID),
    ).toThrow("Ya existe un contacto con este RIF/CI.");
    expect(mockContacts).toHaveLength(before);
  });

  it("la edición queda guardada", () => {
    const created = createContact({ name: "Distribuidora Polar" }, DEFAULT_STORE_ID);

    expect(
      updateContact(created.id, { isActive: false, phone: "0412-0000001" }, DEFAULT_STORE_ID),
    ).toMatchObject({ isActive: false, name: "Distribuidora Polar", phone: "0412-0000001" });
    expect(getContactById(created.id, DEFAULT_STORE_ID)).toMatchObject({
      isActive: false,
      name: "Distribuidora Polar",
      phone: "0412-0000001",
    });
    expect(listNames("isActive=false&limit=100")).toContain("Distribuidora Polar");
  });

  it("una edición rechazada no cambia el contacto y el default del POS conserva su marca", () => {
    expect(() => updateContact("cont-walk-in", { isActive: false }, DEFAULT_STORE_ID)).toThrow(
      "No se puede desactivar el cliente default del POS.",
    );
    expect(getContactById("cont-walk-in", DEFAULT_STORE_ID).isActive).toBe(true);

    updateContact("cont-walk-in", { phone: "0212-0000000" }, DEFAULT_STORE_ID);

    expect(getContactById("cont-walk-in", DEFAULT_STORE_ID)).toMatchObject({
      isPosDefault: true,
      phone: "0212-0000000",
    });
  });
});
