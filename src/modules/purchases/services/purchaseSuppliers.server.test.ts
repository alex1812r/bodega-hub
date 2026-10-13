/**
 * @jest-environment node
 */
/**
 * COM-F9 · proveedores para compras en el servidor real: la consulta a `contacts`
 * va con la sesión del usuario, acotada a la tienda, a `proveedor`/`ambos` y a las
 * cuatro columnas que se entregan.
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../lib/supabase/admin-client");

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import { getPurchaseSupplierById, listPurchaseSuppliers } from "./purchaseSuppliers.server";

const STORE_ID = "00000000-0000-4000-8000-000000000001";
const SUPPLIER_ID = "11111111-1111-4111-8111-111111111111";

type QueryResult = { count?: number | null; data?: unknown; error?: unknown };

function mockContactsQuery(result: QueryResult) {
  const query: Record<"eq" | "in" | "or" | "order" | "select", jest.Mock> & {
    maybeSingle: jest.Mock;
    range: jest.Mock;
  } = {
    eq: jest.fn(() => query),
    in: jest.fn(() => query),
    maybeSingle: jest.fn(async () => result),
    or: jest.fn(() => query),
    order: jest.fn(() => query),
    range: jest.fn(async () => result),
    select: jest.fn(() => query),
  };
  const from = jest.fn(() => query);

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from });

  return { from, query };
}

describe("purchaseSuppliers.server", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Lee con la sesión del usuario (RLS), nunca con la clave de servicio.
    expect(createAdminSupabaseClient).not.toHaveBeenCalled();
  });

  describe("listPurchaseSuppliers", () => {
    it("consulta proveedores activos de la tienda y entrega solo los campos mínimos", async () => {
      const { from, query } = mockContactsQuery({
        count: 12,
        data: [
          { id: SUPPLIER_ID, is_active: true, name: "Suministros Industriales CA", tax_id: null },
        ],
      });

      const page = await listPurchaseSuppliers({ limit: 8, skip: 16 }, STORE_ID);

      expect(from).toHaveBeenCalledWith("contacts");
      expect(query.select).toHaveBeenCalledWith("id, name, tax_id, is_active", { count: "exact" });
      expect(query.eq.mock.calls).toEqual([
        ["store_id", STORE_ID],
        ["is_active", true],
      ]);
      expect(query.in).toHaveBeenCalledWith("type", ["proveedor", "ambos"]);
      expect(query.or).not.toHaveBeenCalled();
      expect(query.order).toHaveBeenCalledWith("name");
      expect(query.range).toHaveBeenCalledWith(16, 23);
      expect(page).toEqual({
        items: [
          { id: SUPPLIER_ID, isActive: true, name: "Suministros Industriales CA", taxId: "" },
        ],
        limit: 8,
        skip: 16,
        total: 12,
      });
    });

    it("busca por nombre o RIF, nunca por teléfono", async () => {
      const { query } = mockContactsQuery({ count: 0, data: [] });

      await listPurchaseSuppliers({ limit: 8, search: "J-0000", skip: 0 }, STORE_ID);

      expect(query.or).toHaveBeenCalledWith("name.ilike.%J-0000%,tax_id.ilike.%J-0000%");
    });

    it("quita de la búsqueda lo que PostgREST leería como sintaxis o comodín", async () => {
      const { query } = mockContactsQuery({ count: 0, data: [] });

      await listPurchaseSuppliers({ limit: 8, search: 'a%_,()*"\\b', skip: 0 }, STORE_ID);

      expect(query.or).toHaveBeenCalledWith("name.ilike.%ab%,tax_id.ilike.%ab%");

      await listPurchaseSuppliers({ limit: 8, search: "%_,", skip: 0 }, STORE_ID);

      expect(query.or).toHaveBeenCalledTimes(1);
    });

    it("propaga el error de la consulta", async () => {
      mockContactsQuery({ error: { code: "42501", message: "permission denied" } });

      await expect(listPurchaseSuppliers({ limit: 8, skip: 0 }, STORE_ID)).rejects.toBeDefined();
    });
  });

  describe("getPurchaseSupplierById", () => {
    it("lee el proveedor de la tienda sin filtrar por activo", async () => {
      const { query } = mockContactsQuery({
        data: { id: SUPPLIER_ID, is_active: false, name: "Proveedor Dado De Baja", tax_id: "J-9" },
      });

      const supplier = await getPurchaseSupplierById(SUPPLIER_ID, STORE_ID);

      expect(query.select).toHaveBeenCalledWith("id, name, tax_id, is_active");
      expect(query.eq.mock.calls).toEqual([
        ["id", SUPPLIER_ID],
        ["store_id", STORE_ID],
      ]);
      expect(query.in).toHaveBeenCalledWith("type", ["proveedor", "ambos"]);
      expect(supplier).toEqual({
        id: SUPPLIER_ID,
        isActive: false,
        name: "Proveedor Dado De Baja",
        taxId: "J-9",
      });
    });

    it("responde 404 si no hay un proveedor con ese id en la tienda", async () => {
      mockContactsQuery({ data: null });

      await expect(getPurchaseSupplierById(SUPPLIER_ID, STORE_ID)).rejects.toMatchObject({
        message: "Proveedor no encontrado.",
        status: 404,
      });
    });

    it("responde 404 sin consultar cuando el id no es un uuid", async () => {
      const { from } = mockContactsQuery({ data: null });

      await expect(getPurchaseSupplierById("cont-supplier", STORE_ID)).rejects.toMatchObject({
        status: 404,
      });
      expect(from).not.toHaveBeenCalled();
    });
  });
});
