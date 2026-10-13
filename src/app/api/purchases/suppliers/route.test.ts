/**
 * @jest-environment node
 */
/**
 * COM-F9 · `GET /api/purchases/suppliers`: el buscador de proveedores de la compra
 * se autoriza con `purchases.create` (almacén no tiene `contacts.view`) y devuelve
 * solo `id`, `name`, `taxId` e `isActive`.
 */

import { mockContacts } from "@/shared/mocks/erp-data";

import { GET } from "./route";

const BASE_URL = "http://localhost/api/purchases/suppliers";
const SUPPLIER_KEYS = ["id", "isActive", "name", "taxId"];

type SupplierBody = { id: string; isActive: boolean; name: string; taxId: string };

function get(query = "", role?: string) {
  return GET(
    new Request(`${BASE_URL}${query}`, {
      headers: role ? { "x-demo-role": role } : undefined,
    }),
  );
}

async function listIds(query = "", role?: string) {
  const response = await get(query, role);
  const body = await response.json();

  expect(response.status).toBe(200);

  return (body.data.items as SupplierBody[]).map((supplier) => supplier.id);
}

describe("GET /api/purchases/suppliers", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;
  const added: string[] = [];

  function addContact(overrides: Partial<(typeof mockContacts)[number]> & { id: string }) {
    mockContacts.push({
      address: "Calle 1",
      email: "privado@example.com",
      isActive: true,
      name: overrides.id,
      phone: "0412-5550000",
      taxId: "",
      type: "proveedor",
      ...overrides,
    });
    added.push(overrides.id);
  }

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
  });

  afterEach(() => {
    for (const id of added.splice(0)) {
      const index = mockContacts.findIndex((contact) => contact.id === id);

      if (index >= 0) {
        mockContacts.splice(index, 1);
      }
    }
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it.each([
    ["admin", 200],
    ["almacen", 200],
    ["contador", 403],
    ["vendedor", 403],
  ])("responde a %s con %i (permiso purchases.create)", async (role, status) => {
    const list = await get("?search=sum", role);
    const byId = await get("?id=cont-supplier", role);

    expect(list.status).toBe(status);
    expect(byId.status).toBe(status);
  });

  it("devuelve a almacén los proveedores con la envoltura paginada y solo los campos mínimos", async () => {
    const response = await get("?search=Sum", "almacen");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(Object.keys(body.data).sort()).toEqual(["items", "limit", "skip", "total"]);
    expect(body.data.items).toEqual([
      {
        id: "cont-supplier",
        isActive: true,
        name: "Suministros Industriales CA",
        taxId: "J-00000002-2",
      },
    ]);
    expect(body.data.total).toBe(1);
    expect(body.data.skip).toBe(0);
  });

  it("nunca devuelve teléfono, dirección, correo ni otros campos del contacto", async () => {
    const list = await (await get("?limit=20", "almacen")).json();
    const byId = await (await get("?id=cont-supplier", "almacen")).json();

    expect(list.data.items.length).toBeGreaterThan(0);

    for (const supplier of [...list.data.items, byId.data]) {
      expect(Object.keys(supplier).sort()).toEqual(SUPPLIER_KEYS);
    }
  });

  it("lista solo contactos de tipo proveedor o ambos", async () => {
    const ids = await listIds("?limit=20");
    const typeById = new Map(mockContacts.map((contact) => [contact.id, contact.type]));

    expect(ids).toEqual(expect.arrayContaining(["cont-supplier", "cont-both", "cont-supplier-tools"]));
    expect(ids).not.toContain("cont-customer");
    expect(ids.every((id) => typeById.get(id) !== "cliente")).toBe(true);
  });

  it("busca en servidor por nombre o por RIF, no por teléfono", async () => {
    addContact({ id: "sup-f9-telefono", name: "Proveedor Reservado", phone: "0412-7778899" });

    expect(await listIds("?search=doble")).toEqual(["cont-both"]);
    expect(await listIds("?search=J-00000005")).toEqual(["cont-supplier-tools"]);
    expect(await listIds("?search=7778899")).toEqual([]);
    expect(await listIds("?search=zzzz")).toEqual([]);
  });

  it("deja fuera los inactivos de la búsqueda pero los devuelve por id", async () => {
    addContact({ id: "sup-f9-inactivo", isActive: false, name: "Proveedor Dado De Baja", taxId: "J-9" });

    expect(await listIds("?search=dado de baja")).toEqual([]);
    expect(await listIds("?limit=20")).not.toContain("sup-f9-inactivo");

    const response = await get("?id=sup-f9-inactivo", "almacen");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      id: "sup-f9-inactivo",
      isActive: false,
      name: "Proveedor Dado De Baja",
      taxId: "J-9",
    });
  });

  it("responde 404 por id a un contacto que no existe o que no es proveedor", async () => {
    const missing = await get("?id=no-existe");
    const customer = await get("?id=cont-customer");

    expect(missing.status).toBe(404);
    expect(customer.status).toBe(404);
    expect((await customer.json()).error.message).toBe("Proveedor no encontrado.");
  });

  it("no entrega proveedores de otra tienda", async () => {
    const otherStore = "00000000-0000-4000-8000-0000000000ff";

    addContact({ id: "sup-f9-otra-tienda", name: "Proveedor Ajeno", storeId: otherStore });

    expect(await listIds("?search=ajeno")).toEqual([]);
    expect((await get("?id=sup-f9-otra-tienda")).status).not.toBe(200);
  });

  it("acota limit a 20 y usa 8 por defecto", async () => {
    for (let index = 0; index < 25; index += 1) {
      addContact({ id: `sup-f9-lote-${index}`, name: `Lote F9 ${String(index).padStart(2, "0")}` });
    }

    const capped = await (await get("?search=lote f9&limit=100")).json();
    const byDefault = await (await get("?search=lote f9")).json();
    const small = await (await get("?search=lote f9&limit=3&skip=3")).json();

    expect(capped.data.limit).toBe(20);
    expect(capped.data.items).toHaveLength(20);
    expect(capped.data.total).toBe(25);
    expect(byDefault.data.limit).toBe(8);
    expect(byDefault.data.items).toHaveLength(8);
    expect(small.data.items.map((supplier: SupplierBody) => supplier.name)).toEqual([
      "Lote F9 03",
      "Lote F9 04",
      "Lote F9 05",
    ]);
  });

  it.each([
    ["?limit=abc"],
    ["?limit=0"],
    ["?limit=-1"],
    ["?limit=2.5"],
    ["?skip=-1"],
    ["?skip=x"],
    ["?id="],
    ["?id=con%20espacios"],
    [`?id=${"a".repeat(65)}`],
    [`?search=${"a".repeat(101)}`],
    ["?search=a%00b"],
  ])("responde 400 con parámetros inválidos (%s)", async (query) => {
    const response = await get(query);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("BAD_REQUEST");
  });

  it("trata search, limit y skip vacíos como no enviados", async () => {
    const response = await get("?search=&limit=&skip=");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.limit).toBe(8);
    expect(body.data.skip).toBe(0);
  });
});
