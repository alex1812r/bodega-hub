import {
  assertCanAccessContact,
  assertCanAccessSupplierContacts,
  assertCanQueryContactType,
  assertCanWriteContactType,
  canViewSupplierContacts,
  isCustomerContactType,
  isSupplierContactType,
  SUPPLIER_CONTACTS_FORBIDDEN_MESSAGE,
} from "./contactAccess";

describe("contactAccess", () => {
  it("restricts supplier contacts to non-vendedor roles", () => {
    expect(canViewSupplierContacts("admin")).toBe(true);
    expect(canViewSupplierContacts("contador")).toBe(true);
    expect(canViewSupplierContacts("vendedor")).toBe(false);
  });

  it("treats only cliente as customer contact", () => {
    expect(isCustomerContactType("cliente")).toBe(true);
    expect(isCustomerContactType("ambos")).toBe(false);
    expect(isSupplierContactType("proveedor")).toBe(true);
    expect(isSupplierContactType("ambos")).toBe(true);
  });

  it("blocks vendedor from querying supplier types", () => {
    expect(() =>
      assertCanQueryContactType("vendedor", new URLSearchParams("type=proveedor")),
    ).toThrow(SUPPLIER_CONTACTS_FORBIDDEN_MESSAGE);

    expect(() =>
      assertCanQueryContactType("vendedor", new URLSearchParams("type=ambos")),
    ).toThrow(SUPPLIER_CONTACTS_FORBIDDEN_MESSAGE);

    expect(() =>
      assertCanQueryContactType("vendedor", new URLSearchParams("type=cliente")),
    ).not.toThrow();
  });

  it("blocks vendedor from accessing supplier contacts", () => {
    expect(() => assertCanAccessContact("vendedor", { type: "proveedor" })).toThrow(
      SUPPLIER_CONTACTS_FORBIDDEN_MESSAGE,
    );
    expect(() => assertCanAccessContact("vendedor", { type: "ambos" })).toThrow(
      SUPPLIER_CONTACTS_FORBIDDEN_MESSAGE,
    );
    expect(() => assertCanAccessContact("vendedor", { type: "cliente" })).not.toThrow();
  });

  it("blocks vendedor from writing supplier contact types", () => {
    expect(() => assertCanWriteContactType("vendedor", "proveedor")).toThrow(
      SUPPLIER_CONTACTS_FORBIDDEN_MESSAGE,
    );
    expect(() => assertCanWriteContactType("vendedor", "cliente")).not.toThrow();
  });

  it("blocks supplier catalog access for vendedor", () => {
    expect(() => assertCanAccessSupplierContacts("vendedor")).toThrow(
      SUPPLIER_CONTACTS_FORBIDDEN_MESSAGE,
    );
    expect(() => assertCanAccessSupplierContacts("admin")).not.toThrow();
  });
});
