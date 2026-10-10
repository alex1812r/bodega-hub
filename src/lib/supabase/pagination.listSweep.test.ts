/**
 * @jest-environment node
 */
/**
 * POS-H2 · Barrido de las listas paginadas del BFF que pasaron a `fetchListPage`.
 *
 * Con `skip` más allá del total PostgREST responde 416 / `PGRST103` y la ruta
 * devolvía 500. Para CADA servicio se simula el cliente de Supabase y se afirma:
 *  - 416 → no lanza: `items: []`, el total real y el `skip`/`limit` pedidos;
 *  - el total sale de UNA consulta `head: true` con los MISMOS filtros;
 *  - en el camino normal no hay consulta de conteo (ni una petición de más).
 */

jest.mock("./route-client");
jest.mock("./admin-client");

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import {
  getContactPayments,
  getContactPurchases,
  getContactSales,
  listContacts,
} from "@/modules/contacts/services/contacts.server";
import {
  listSupplierProductPriceHistory,
  listSupplierProducts,
} from "@/modules/contacts/services/supplierProducts.server";
import {
  getDashboardLowStock,
  getRecentSales,
} from "@/modules/dashboard/services/dashboard.server";
import { listPayments } from "@/modules/payments/services/payments.server";
import { listMyPayrollItems, listPayrollPeriods } from "@/modules/payroll/services/payroll.server";
import { listStores } from "@/modules/platform/services/stores.server";
import { getProductPriceHistory } from "@/modules/products/services/products.server";
import { listPurchaseSuppliers } from "@/modules/purchases/services/purchaseSuppliers.server";
import { listSales } from "@/modules/sales/services/sales.server";
import { listExchangeRates } from "@/modules/settings/services/exchangeRates.server";
import { listUsers } from "@/modules/settings/services/settings.server";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

type QueryResult = { count: number | null; data: unknown; error: unknown; status: number };
type Call = [method: string, ...args: unknown[]];
type RecordedQuery = { calls: Call[]; head: boolean; ranged: boolean; table: string };

const TOTAL = 7;
const ID = "11111111-1111-4111-8111-111111111111";

/** Lo que entrega `@supabase/postgrest-js` cuando PostgREST responde 416. */
const RANGE_ERROR: QueryResult = {
  count: null,
  data: null,
  error: {
    code: "PGRST103",
    details: `An offset of 999999 was requested, but there are only ${TOTAL} rows.`,
    hint: null,
    message: "Requested range not satisfiable",
  },
  status: 416,
};

/** Fila genérica para las lecturas previas de un solo registro (existe y es de la tienda). */
const SINGLE_ROW = { id: ID, name: "Fila", store_id: DEFAULT_STORE_ID, type: "ambos" };

/**
 * Cliente de Supabase en memoria. Cada `select` abre una consulta y registra sus
 * llamadas: la que termina en `range` responde `rangeResult`; la `head: true`,
 * el total; cualquier otra lectura, una lista vacía.
 */
function installSupabase(rangeResult: QueryResult) {
  const queries: RecordedQuery[] = [];

  const from = (table: string) => ({
    select: (_columns: string, options?: { head?: boolean }) => {
      const query: RecordedQuery = { calls: [], head: options?.head === true, ranged: false, table };
      const settle = (): QueryResult => {
        if (query.head) {
          return { count: TOTAL, data: null, error: null, status: 200 };
        }

        return query.ranged ? rangeResult : { count: null, data: [], error: null, status: 200 };
      };
      const chain: Record<string, unknown> = new Proxy(
        {},
        {
          get(_target, property) {
            if (property === "then") {
              return (resolve: (value: QueryResult) => unknown) => resolve(settle());
            }

            if (property === "single" || property === "maybeSingle") {
              return () => Promise.resolve({ data: SINGLE_ROW, error: null });
            }

            return (...args: unknown[]) => {
              query.calls.push([String(property), ...args]);
              query.ranged = query.ranged || property === "range";

              return chain;
            };
          },
        },
      );

      queries.push(query);

      return chain;
    },
  });

  const client = {
    auth: { admin: { listUsers: () => Promise.resolve({ data: { users: [] }, error: null }) } },
    from,
  };

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue(client);
  (createAdminSupabaseClient as jest.Mock).mockReturnValue(client);

  return queries;
}

/** Filtros de una consulta: todo menos el orden y el rango. */
function filtersOf(query: RecordedQuery) {
  return query.calls.filter(([method]) => method !== "order" && method !== "range");
}

type ListResult = { items: unknown[]; limit: number; skip: number; total: number };
type SweepCase = {
  /** Nº mínimo de filtros que la consulta de conteo debe repetir. */
  minFilters: number;
  run: (searchParams: URLSearchParams) => Promise<ListResult>;
  /** Parámetros de filtro de la petición (además de `skip` / `limit`). */
  query?: string;
  table: string;
};

const CASES: Record<string, SweepCase> = {
  "contacts · listContacts": {
    minFilters: 4,
    query: "type=cliente&isActive=true&search=ana",
    run: (params) => listContacts(params, DEFAULT_STORE_ID),
    table: "contacts",
  },
  "contacts · getContactSales": {
    minFilters: 2,
    run: (params) => getContactSales(ID, params, DEFAULT_STORE_ID),
    table: "sales",
  },
  "contacts · getContactPurchases": {
    minFilters: 2,
    run: (params) => getContactPurchases(ID, params, DEFAULT_STORE_ID),
    table: "purchases",
  },
  "contacts · getContactPayments": {
    minFilters: 3,
    run: (params) => getContactPayments(ID, params, DEFAULT_STORE_ID, { salePaymentsOnly: true }),
    table: "payments",
  },
  "supplier-products · listSupplierProducts": {
    minFilters: 4,
    query: `productId=${ID}&supplierId=${ID}&isActive=true`,
    run: (params) => listSupplierProducts(params, DEFAULT_STORE_ID),
    table: "supplier_products",
  },
  "supplier-products · listSupplierProductPriceHistory": {
    minFilters: 1,
    run: (params) => listSupplierProductPriceHistory(ID, params, DEFAULT_STORE_ID),
    table: "supplier_product_price_history",
  },
  "products · getProductPriceHistory": {
    minFilters: 1,
    run: (params) => getProductPriceHistory(ID, params, DEFAULT_STORE_ID),
    table: "product_price_history",
  },
  "sales · listSales": {
    minFilters: 6,
    query: `status=pagada&customerId=${ID}&search=F-1&from=2026-05-01&to=2026-05-18`,
    run: (params) => listSales(params, DEFAULT_STORE_ID),
    table: "sales",
  },
  "payments · listPayments": {
    minFilters: 6,
    query: `direction=in&method=efectivo_ves&contactId=${ID}&from=2026-05-01&to=2026-05-18`,
    run: (params) => listPayments(params, DEFAULT_STORE_ID, { salePaymentsOnly: true }),
    table: "payments",
  },
  "purchases · listPurchaseSuppliers": {
    minFilters: 4,
    run: async (params) =>
      listPurchaseSuppliers(
        { limit: Number(params.get("limit")), search: "polar", skip: Number(params.get("skip")) },
        DEFAULT_STORE_ID,
      ),
    table: "contacts",
  },
  "settings · listUsers": {
    minFilters: 1,
    run: (params) => listUsers(params, DEFAULT_STORE_ID),
    table: "profiles",
  },
  "settings · listExchangeRates": {
    minFilters: 3,
    query: "from=2026-05-01&to=2026-05-18",
    run: (params) => listExchangeRates(params, DEFAULT_STORE_ID),
    table: "exchange_rates",
  },
  "payroll · listPayrollPeriods": {
    minFilters: 1,
    run: (params) => listPayrollPeriods(params, DEFAULT_STORE_ID),
    table: "payroll_periods",
  },
  "payroll · listMyPayrollItems": {
    minFilters: 2,
    run: (params) => listMyPayrollItems(params, { profileId: ID, storeId: DEFAULT_STORE_ID }),
    table: "payroll_items",
  },
  "platform · listStores": {
    minFilters: 2,
    query: "search=luces&status=active",
    run: (params) => listStores(params),
    table: "stores",
  },
  "dashboard · getRecentSales (tienda y plataforma)": {
    minFilters: 1,
    run: (params) => getRecentSales(params, [DEFAULT_STORE_ID, ID], { useAdmin: true }),
    table: "sales",
  },
  "dashboard · getDashboardLowStock (tienda y plataforma)": {
    minFilters: 1,
    run: (params) => getDashboardLowStock(params, DEFAULT_STORE_ID),
    table: "low_stock_products",
  },
};

const CASE_NAMES = Object.keys(CASES);

function toParams(sweepCase: SweepCase, paging: string) {
  return new URLSearchParams(sweepCase.query ? `${sweepCase.query}&${paging}` : paging);
}

describe("listas paginadas · página más allá del total (POS-H2)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each(CASE_NAMES)("%s: 416 / PGRST103 → vacío con el total real, sin lanzar", async (name) => {
    const sweepCase = CASES[name];
    const queries = installSupabase(RANGE_ERROR);

    const result = await sweepCase.run(toParams(sweepCase, "skip=999999&limit=20"));

    expect(result).toEqual({ items: [], limit: 20, skip: 999999, total: TOTAL });

    const listQueries = queries.filter((query) => query.table === sweepCase.table);
    const ranged = listQueries.filter((query) => query.ranged);
    const counted = listQueries.filter((query) => query.head && !query.ranged);

    expect(ranged).toHaveLength(1);
    expect(counted).toHaveLength(1);
    expect(ranged[0].calls.at(-1)).toEqual(["range", 999999, 1000018]);
    // El total es el de la MISMA lista: mismos filtros, sin orden ni rango.
    expect(filtersOf(counted[0])).toEqual(filtersOf(ranged[0]));
    expect(filtersOf(counted[0]).length).toBeGreaterThanOrEqual(sweepCase.minFilters);
    expect(counted[0].calls).toEqual(filtersOf(counted[0]));
  });

  it.each(CASE_NAMES)("%s: el camino normal no cuenta aparte", async (name) => {
    const sweepCase = CASES[name];
    const queries = installSupabase({ count: 0, data: [], error: null, status: 200 });

    const result = await sweepCase.run(toParams(sweepCase, "skip=0&limit=20"));

    expect(result).toEqual({ items: [], limit: 20, skip: 0, total: 0 });

    const listQueries = queries.filter((query) => query.table === sweepCase.table);

    expect(listQueries.filter((query) => query.ranged)).toHaveLength(1);
    expect(listQueries.filter((query) => query.head && !query.ranged)).toHaveLength(0);
  });

  it.each(CASE_NAMES)("%s: otro error de la consulta se sigue lanzando", async (name) => {
    const sweepCase = CASES[name];
    const queries = installSupabase({
      count: null,
      data: null,
      error: { code: "42501", message: "permission denied" },
      status: 403,
    });

    await expect(sweepCase.run(toParams(sweepCase, "skip=0&limit=20"))).rejects.toMatchObject({
      status: 403,
    });
    expect(
      queries.filter((query) => query.table === sweepCase.table && query.head && !query.ranged),
    ).toHaveLength(0);
  });
});
