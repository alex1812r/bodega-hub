/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client");

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import type { GlobalSearchScopes } from "../types";
import { searchStore } from "./search.server";

type TableResult = { data?: unknown; error?: unknown };

type RecordedQuery = {
  eq: [string, unknown][];
  limit?: number;
  or: string[];
  select?: string;
  table: string;
};

const ALL_SCOPES: GlobalSearchScopes = {
  contacts: true,
  customersOnly: false,
  products: true,
  purchases: true,
  sales: true,
};

/** Cliente falso: anota cada consulta y responde por tabla. */
function createMockSupabase(results: Record<string, TableResult> = {}) {
  const queries: RecordedQuery[] = [];
  const writes = { insert: jest.fn(), rpc: jest.fn(), update: jest.fn() };

  const supabase = {
    from: jest.fn((table: string) => {
      const recorded: RecordedQuery = { eq: [], or: [], table };
      const result = { data: [], error: null, ...results[table] };
      const chain = {
        eq(column: string, value: unknown) {
          recorded.eq.push([column, value]);
          return chain;
        },
        insert: writes.insert,
        limit(count: number) {
          recorded.limit = count;
          return chain;
        },
        or(filter: string) {
          recorded.or.push(filter);
          return chain;
        },
        order() {
          return chain;
        },
        select(columns: string) {
          recorded.select = columns;
          return chain;
        },
        then(resolve: (value: TableResult) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve(result).then(resolve, reject);
        },
        update: writes.update,
      };

      queries.push(recorded);

      return chain;
    }),
    rpc: writes.rpc,
  };

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue(supabase);

  return { queries, writes };
}

function run(query: string, scopes: Partial<GlobalSearchScopes> = {}) {
  return searchStore({ query, scopes: { ...ALL_SCOPES, ...scopes }, storeId: DEFAULT_STORE_ID });
}

describe("search.server", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("scopes every read to the session store, limits it and never writes", async () => {
    const { queries, writes } = createMockSupabase();

    await run("taladro");

    expect(queries.map((query) => query.table).sort()).toEqual([
      "contacts",
      "products",
      "products",
      "purchases",
      "sales",
    ]);

    for (const query of queries) {
      expect(query.eq).toContainEqual(["store_id", DEFAULT_STORE_ID]);
      expect(query.limit).toBeLessThanOrEqual(10);
      expect(query.or).toHaveLength(1);
    }

    expect(writes.insert).not.toHaveBeenCalled();
    expect(writes.update).not.toHaveBeenCalled();
    expect(writes.rpc).not.toHaveBeenCalled();
  });

  it("only reads the tables the role may see", async () => {
    const { queries } = createMockSupabase();

    await run("taladro", { contacts: false, products: false, purchases: false });

    expect(queries.map((query) => query.table)).toEqual(["sales"]);
  });

  it("restricts the seller to contacts of type cliente", async () => {
    const { queries } = createMockSupabase();

    await run("ana", { customersOnly: true, products: false, purchases: false, sales: false });

    expect(queries[0].eq).toContainEqual(["type", "cliente"]);
  });

  it("never compares a non-UUID term against an id column", async () => {
    const { queries } = createMockSupabase();

    await run("V-20261009-000123");

    for (const query of queries) {
      expect(query.or[0]).not.toContain("id.eq");
    }
  });

  it("adds the id match only for a well-formed UUID, lowercased", async () => {
    const { queries } = createMockSupabase();

    await run("3F2B8C1E-5D47-4A9B-8E21-0C9D7A6B5E4F");

    const sales = queries.find((query) => query.table === "sales");
    const strongProducts = queries.find(
      (query) => query.table === "products" && query.or[0].includes("id.eq"),
    );

    expect(sales?.or[0]).toBe(
      'invoice_number.ilike."%3F2B8C1E-5D47-4A9B-8E21-0C9D7A6B5E4F%",id.eq.3f2b8c1e-5d47-4a9b-8e21-0c9d7a6b5e4f',
    );
    expect(strongProducts).toBeDefined();
  });

  it("keeps PostgREST and LIKE metacharacters as quoted text", async () => {
    const { queries } = createMockSupabase();

    await run(`a%_*\\",(b).c:d'`);

    const contacts = queries.find((query) => query.table === "contacts");

    expect(contacts?.or[0]).toBe(
      [
        `name.ilike."%a_____,(b).c:d'%"`,
        `tax_id.ilike."%a_____,(b).c:d'%"`,
        `phone.ilike."%a_____,(b).c:d'%"`,
      ].join(","),
    );

    for (const query of queries) {
      // Cada valor va entre comillas y sin comillas ni barras dentro: nada cierra el `or=(…)`.
      const values = query.or[0].match(/"[^"]*"/g) ?? [];

      expect(values.length).toBeGreaterThan(0);
      expect(query.or[0].replace(/"[^"]*"/g, "")).toMatch(/^[a-z_.,]+$/);
    }
  });

  it("ranks exact barcode first, then SKU matches, and drops duplicates", async () => {
    createMockSupabase({
      products: {
        data: [
          { barcode: null, id: "p-name", name: "Caja 750 ml", sku: "zzz-1" },
          { barcode: null, id: "p-prefix", name: "Botella", sku: "7501-A" },
          { barcode: "750", id: "p-barcode", name: "Vaso", sku: "vas-1" },
          { barcode: null, id: "p-sku", name: "Agua", sku: "750" },
        ],
      },
    });

    const result = await run("750", { contacts: false, purchases: false, sales: false });

    expect(result.products.map((product) => product.id)).toEqual([
      "p-barcode",
      "p-sku",
      "p-prefix",
      "p-name",
    ]);
  });

  it("maps documents and contacts to the small public shape", async () => {
    createMockSupabase({
      contacts: { data: [{ id: "c1", name: "Ana", tax_id: "", type: "cliente" }] },
      purchases: {
        data: [
          {
            created_at: "2026-10-08T12:00:00Z",
            id: "pu1",
            purchase_number: "C-20261008-000002",
            status: "recibido",
            supplier: { name: "Proveedor" },
            total_ref: "12.50",
          },
        ],
      },
      sales: {
        data: [
          {
            created_at: "2026-10-09T12:00:00Z",
            customer: null,
            id: "s1",
            invoice_number: "V-20261009-000001",
            status: "pagada",
            total_ref: "30.10",
          },
        ],
      },
    });

    const result = await run("0000", { products: false });

    expect(result).toEqual({
      contacts: [{ id: "c1", name: "Ana", taxId: null, type: "cliente" }],
      products: [],
      purchases: [
        {
          createdAt: "2026-10-08T12:00:00Z",
          id: "pu1",
          number: "C-20261008-000002",
          status: "recibido",
          supplierName: "Proveedor",
          totalRef: 12.5,
        },
      ],
      sales: [
        {
          createdAt: "2026-10-09T12:00:00Z",
          customerName: null,
          id: "s1",
          number: "V-20261009-000001",
          status: "pagada",
          totalRef: 30.1,
        },
      ],
    });
  });

  it("surfaces a database failure as an error instead of partial results", async () => {
    createMockSupabase({ sales: { error: { code: "XX000", message: "boom" } } });

    await expect(run("taladro")).rejects.toBeDefined();
  });
});
