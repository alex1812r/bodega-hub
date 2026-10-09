/** @jest-environment node */
/**
 * INV-01a · regresión del parche `20261011a-inventory-overview.sql`: vista `public.inventory_overview` (una fila por
 * producto con entradas / salidas de 30 días, último movimiento por `seq` y `stock_status`), sus permisos, el
 * aislamiento por tienda y el rendimiento de una página con conteo sobre 5.000 productos.
 *
 * Los datos se preparan como `postgres` dentro de una transacción que termina en `rollback` (no queda nada en la
 * base); el stock se mueve insertando movimientos (nadie escribe `current_stock`). Cada lectura probada se ejecuta con
 * `set local role authenticated` + `request.jwt.claims` del usuario lab (ACL y RLS de PostgREST). El último bloque lee
 * por PostgREST con la sesión real del usuario lab (solo lectura).
 *
 *   npm run stock-lab:test -- scripts/stock-lab/regression/inventory-overview.test.ts
 *
 * Un fallo de preparación empieza por "SETUP".
 */
import { randomUUID } from "node:crypto";

import { Client } from "pg";

import { isRangeNotSatisfiable } from "../../../src/modules/products/services/listRange";
import type { LabRoleKey } from "../agents/base";
import { withRollback } from "../db-test-utils";
import { Lab, actAs } from "../scenarios/db";

type Row = Record<string, unknown>;
type Outcome = { rows: Row[]; code: string | null; message: string; ms: number };
type Role = LabRoleKey | "anon";

const TAG = `inv01a-${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
const INSUFFICIENT_PRIVILEGE = "42501";
const PERF_PRODUCTS = 5000;
const PERF_BUDGET_MS = 2000;
const PAGE_SIZE = 50;

/** Columnas que lee `listInventory` (sin el embed de categoría, que resuelve PostgREST). */
const OVERVIEW_COLUMNS =
  "id, category_id, sku, barcode, name, sale_price_ref, current_cost_ref, current_stock, min_stock, image_url, is_active, entries_30d, exits_30d, last_movement_at, last_movement_type, stock_status";

/** El `select` de `listInventory`, con el embed de categoría. */
const OVERVIEW_REST_SELECT = `${OVERVIEW_COLUMNS}, category:categories(id, name, description, is_active, created_at, updated_at)`;

let lab: Lab;
let db: Client;
let seq = 0;

function failure(error: unknown): { code: string; message: string } {
  const code = (error as { code?: unknown }).code;
  return { code: typeof code === "string" ? code : "?", message: error instanceof Error ? error.message : String(error) };
}

/** SQL de preparación / lectura como `postgres`. Si falla, el test no pudo montarse. */
async function sql(what: string, text: string, params: unknown[] = []): Promise<Row[]> {
  try {
    return (await db.query<Row>(text, params)).rows;
  } catch (error) {
    const { code, message } = failure(error);
    throw new Error(`SETUP · ${what}: ${code} ${message}`);
  }
}

/**
 * Ejecuta `text` dentro de un savepoint como el usuario lab `role` (o como `anon`). Devuelve el error (SQLSTATE +
 * mensaje) en vez de lanzarlo, el tiempo que tardó, y deja la transacción utilizable y en el rol de la sesión.
 */
async function run(role: Role, text: string, params: unknown[] = []): Promise<Outcome> {
  await db.query("savepoint inv01a");
  const started = Date.now();
  try {
    await actAs(db, role === "anon" ? null : lab.uids[role]);
    const res = await db.query<Row>(text, params);
    const ms = Date.now() - started;
    await db.query("reset role");
    await db.query("release savepoint inv01a");
    return { rows: res.rows, code: null, message: "", ms };
  } catch (error) {
    await db.query("rollback to savepoint inv01a");
    await db.query("reset role");
    return { rows: [], ...failure(error), ms: Date.now() - started };
  }
}

async function product(minStock: number, storeId: string = lab.storeId, isActive = true): Promise<string> {
  seq += 1;
  const sku = `${TAG}-p${seq}`;
  const rows = await sql(
    `producto ${sku}`,
    `insert into public.products (store_id, sku, name, sale_price_ref, current_cost_ref, current_stock, min_stock, is_active)
     values ($1, $2, $2, 10, 6, 0, $3, $4) returning id`,
    [storeId, sku, minStock, isActive],
  );
  return String(rows[0].id);
}

/** Movimiento del libro: el trigger fija `seq`, `stock_after` y `current_stock`. `daysAgo` fecha el `created_at`. */
async function move(productId: string, type: string, delta: number, daysAgo: number): Promise<void> {
  await sql(
    `movimiento ${type} ${delta}`,
    `insert into public.stock_movements (store_id, product_id, type, quantity_delta, stock_after, reason, created_at)
     select p.store_id, p.id, $2::public.stock_movement_type, $3, 0, $4, now() - make_interval(days => $5)
     from public.products p where p.id = $1`,
    [productId, type, delta, TAG, daysAgo],
  );
}

/** Lo que ve `role` de un producto en la vista, reducido a las cifras del libro. `null` = no ve la fila. */
async function overview(role: Role, productId: string): Promise<Row | string | null> {
  const out = await run(
    role,
    `select current_stock, entries_30d, exits_30d, last_movement_type::text as last_type, stock_status,
            round(extract(epoch from now() - last_movement_at) / 86400)::int as last_days_ago
     from public.inventory_overview where id = $1`,
    [productId],
  );
  if (out.code) return out.code;
  return out.rows[0] ?? null;
}

beforeAll(async () => {
  lab = await Lab.open("inv01a");
  db = await lab.pg();
});

afterAll(async () => {
  if (lab) await lab.close();
});

describe("20261011a · forma del esquema", () => {
  it("la vista existe con security_invoker, la leen solo authenticated / service_role y está el índice (product_id, seq desc)", async () => {
    const rows = await sql(
      "forma",
      `select
         c.relkind::text as kind,
         c.reloptions::text[] as options,
         has_table_privilege('authenticated', c.oid, 'select') as authenticated_reads,
         has_table_privilege('service_role', c.oid, 'select') as service_reads,
         has_table_privilege('anon', c.oid, 'select') as anon_reads,
         has_table_privilege('authenticated', c.oid, 'insert, update, delete') as authenticated_writes,
         (select pg_get_indexdef(to_regclass('public.idx_stock_movements_product_seq'))) as index_def,
         (select array_agg(a.attname::text order by a.attnum) from pg_attribute a
            where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) as columns
       from pg_class c where c.oid = to_regclass('public.inventory_overview')`,
    );

    expect(rows[0]).toEqual({
      kind: "v",
      options: ["security_invoker=true"],
      authenticated_reads: true,
      service_reads: true,
      anon_reads: false,
      authenticated_writes: false,
      index_def: expect.stringMatching(/ON public\.stock_movements USING btree \(product_id, seq DESC\)$/),
      columns: [
        "id",
        "store_id",
        "category_id",
        "sku",
        "barcode",
        "name",
        "sale_price_ref",
        "current_cost_ref",
        "current_stock",
        "min_stock",
        "image_url",
        "is_active",
        "entries_30d",
        "exits_30d",
        "last_movement_at",
        "last_movement_type",
        "stock_status",
      ],
    });
  });
});

describe("20261011a · cifras del libro", () => {
  it("entradas y salidas suman solo los últimos 30 días; el último movimiento es el de mayor seq", async () => {
    await withRollback(db, async () => {
      const busy = await product(5);
      await move(busy, "inventario_inicial", 40, 45);
      await move(busy, "ajuste_salida", -6, 31);
      await move(busy, "ajuste_entrada", 10, 29);
      await move(busy, "ajuste_salida", -3, 2);
      await move(busy, "ajuste_entrada", 4, 0);
      await move(busy, "ajuste_salida", -1, 0);

      expect(await overview("admin", busy)).toEqual({
        current_stock: 44,
        entries_30d: 14,
        exits_30d: 4,
        last_type: "ajuste_salida",
        last_days_ago: 0,
        stock_status: "ok",
      });
    });
  });

  it("un movimiento fechado antes pero registrado después es el último (manda seq, no created_at)", async () => {
    await withRollback(db, async () => {
      const backdated = await product(5);
      await move(backdated, "ajuste_entrada", 9, 1);
      await move(backdated, "ajuste_salida", -4, 10);

      expect(await overview("admin", backdated)).toEqual({
        current_stock: 5,
        entries_30d: 9,
        exits_30d: 4,
        last_type: "ajuste_salida",
        last_days_ago: 10,
        stock_status: "low",
      });
    });
  });

  it("producto sin movimientos: ceros, sin último movimiento y agotado", async () => {
    await withRollback(db, async () => {
      const untouched = await product(0);

      expect(await overview("admin", untouched)).toEqual({
        current_stock: 0,
        entries_30d: 0,
        exits_30d: 0,
        last_type: null,
        last_days_ago: null,
        stock_status: "out",
      });
    });
  });

  it("producto cuyo único movimiento tiene más de 30 días: ceros, pero conserva el último movimiento", async () => {
    await withRollback(db, async () => {
      const stale = await product(2);
      await move(stale, "inventario_inicial", 7, 31);

      expect(await overview("admin", stale)).toEqual({
        current_stock: 7,
        entries_30d: 0,
        exits_30d: 0,
        last_type: "inventario_inicial",
        last_days_ago: 31,
        stock_status: "ok",
      });
    });
  });

  it("stock_status reproduce getInventoryStockStatus: 0 = out, <= mínimo = low, resto = ok", async () => {
    await withRollback(db, async () => {
      const cases: Array<[stock: number, min: number, expected: string]> = [
        [0, 0, "out"],
        [0, 5, "out"],
        [1, 5, "low"],
        [5, 5, "low"],
        [6, 5, "ok"],
        [1, 0, "ok"],
      ];

      for (const [stock, min, expected] of cases) {
        const id = await product(min);
        if (stock > 0) await move(id, "inventario_inicial", stock, 0);
        const row = (await overview("admin", id)) as Row;

        expect([stock, min, row.stock_status]).toEqual([stock, min, expected]);
      }
    });
  });

  it("una fila por producto, activos e inactivos, y el filtro por stock_status cuenta lo mismo que la regla", async () => {
    await withRollback(db, async () => {
      const inactive = await product(1, lab.storeId, false);
      await move(inactive, "inventario_inicial", 3, 0);
      await move(inactive, "ajuste_salida", -1, 0);

      const out = await run(
        "admin",
        `select
           (select count(*)::int from public.inventory_overview) as view_rows,
           (select count(*)::int from public.products) as products,
           (select count(*)::int from public.inventory_overview where id = $1 and not is_active) as inactive_rows,
           (select count(*)::int from public.inventory_overview where stock_status = 'low') as low_view,
           (select count(*)::int from public.products where current_stock <> 0 and current_stock <= min_stock) as low_rule`,
        [inactive],
      );

      expect(out.code).toBeNull();
      expect(out.rows[0].view_rows).toBe(out.rows[0].products);
      expect(out.rows[0].inactive_rows).toBe(1);
      expect(out.rows[0].low_view).toBe(out.rows[0].low_rule);
    });
  });
});

describe("20261011a · aislamiento y permisos", () => {
  it("un usuario no ve en la vista los productos de otra tienda, ni sus movimientos", async () => {
    await withRollback(db, async () => {
      const mine = await product(1);
      const foreign = await product(1, lab.defaultStoreId);
      await move(mine, "inventario_inicial", 5, 0);
      await move(foreign, "inventario_inicial", 8, 0);

      const asPostgres = await sql("fila ajena como postgres", "select entries_30d from public.inventory_overview where id = $1", [foreign]);
      expect(asPostgres).toEqual([{ entries_30d: 8 }]);

      for (const role of ["admin", "almacen", "vendedor1", "contador"] as const) {
        expect(await overview(role, foreign)).toBeNull();
      }

      const stores = await run("admin", "select distinct store_id::text as store_id from public.inventory_overview");
      expect(stores.rows).toEqual([{ store_id: lab.storeId }]);
      expect(await overview("admin", mine)).toMatchObject({ current_stock: 5, entries_30d: 5 });
    });
  });

  it("anon no puede leer la vista y nadie puede escribir en ella", async () => {
    await withRollback(db, async () => {
      const mine = await product(1);

      expect(await overview("anon", mine)).toBe(INSUFFICIENT_PRIVILEGE);
      expect((await run("admin", "update public.inventory_overview set min_stock = 9 where id = $1", [mine])).code).toBe(
        INSUFFICIENT_PRIVILEGE,
      );
    });
  });
});

describe("20261011a · rendimiento con 5.000 productos", () => {
  it(`una página de ${PAGE_SIZE} con conteo exacto tarda menos de ${PERF_BUDGET_MS} ms`, async () => {
    await withRollback(db, async () => {
      await sql(
        "5.000 productos",
        `insert into public.products (store_id, sku, name, sale_price_ref, current_cost_ref, current_stock, min_stock, is_active)
         select $1, format('%s-b%s', $2::text, g), format('Perf %s %s', $2::text, lpad(g::text, 5, '0')), 1 + (g % 40), 1, 0, g % 7, true
         from generate_series(1, $3::int) g`,
        [lab.storeId, TAG, PERF_PRODUCTS],
      );
      // Tres movimientos por producto (15.000): uno viejo, una entrada y una salida recientes.
      for (const [type, delta, daysAgo] of [
        ["inventario_inicial", "20", 50],
        ["ajuste_entrada", "5", 5],
        ["ajuste_salida", "-(16 + right(p.sku, 1)::int)", 1],
      ] as const) {
        await sql(
          `movimientos ${type}`,
          `insert into public.stock_movements (store_id, product_id, type, quantity_delta, stock_after, reason, created_at)
           select p.store_id, p.id, '${type}'::public.stock_movement_type, ${delta}, 0, $1, now() - make_interval(days => $2)
           from public.products p where p.sku like $1 || '-b%'`,
          [TAG, daysAgo],
        );
      }
      await sql("analyze products", "analyze public.products");
      await sql("analyze stock_movements", "analyze public.stock_movements");

      const where = "store_id = $1 and is_active";
      const page = (extra: string, offset: number) =>
        `select ${OVERVIEW_COLUMNS} from public.inventory_overview where ${where}${extra} order by name, id limit ${PAGE_SIZE} offset ${offset}`;
      const count = (extra: string) => `select count(*)::int as total from public.inventory_overview where ${where}${extra}`;
      const timings: Record<string, number> = {};

      const measure = async (label: string, extra: string, offset: number): Promise<{ rows: Row[]; total: number }> => {
        const rows = await run("admin", page(extra, offset), [lab.storeId]);
        const total = await run("admin", count(extra), [lab.storeId]);
        if (rows.code || total.code) throw new Error(`${label}: ${rows.code ?? total.code} ${rows.message || total.message}`);
        timings[label] = rows.ms + total.ms;
        return { rows: rows.rows, total: Number(total.rows[0].total) };
      };

      const first = await measure("primera página", "", 0);
      const last = await measure("última página", "", PERF_PRODUCTS - PAGE_SIZE);
      const low = await measure("filtro stock_status low + out", " and stock_status in ('low', 'out')", 0);
      // El número va con el espacio que lo precede: `%0042%` a secas casa también 00420…00429 (11 productos).
      const search = await measure("búsqueda + precio", ` and name ilike '%' || '${TAG}' || '% 00042%' and sale_price_ref between 1 and 40`, 0);

      const reconciliation = await run(
        "admin",
        "select product_id, diff from public.stock_reconciliation where store_id = $1 and product_id = any($2::uuid[])",
        [lab.storeId, first.rows.map((row) => row.id)],
      );
      timings["descuadre de la página (admin)"] = reconciliation.ms;

      const plan = await run("admin", `explain (analyze, costs off, timing off) ${page("", 0)}`, [lab.storeId]);
      const countPlan = await run("admin", `explain (analyze, costs off, timing off) ${count("")}`, [lab.storeId]);

      console.log(
        [
          `INV-01a · rendimiento con ${PERF_PRODUCTS} productos y ${PERF_PRODUCTS * 3} movimientos (página de ${PAGE_SIZE} + conteo, ms):`,
          ...Object.entries(timings).map(([label, ms]) => `  ${label}: ${ms}`),
          "EXPLAIN ANALYZE página:",
          ...plan.rows.map((row) => `  ${String(row["QUERY PLAN"])}`),
          "EXPLAIN ANALYZE conteo:",
          ...countPlan.rows.map((row) => `  ${String(row["QUERY PLAN"])}`),
        ].join("\n"),
      );

      expect(first.total).toBeGreaterThanOrEqual(PERF_PRODUCTS);
      expect(first.rows).toHaveLength(PAGE_SIZE);
      expect(last.rows).toHaveLength(PAGE_SIZE);
      expect(low.total).toBeGreaterThan(0);
      expect(low.total).toBeLessThan(first.total);
      expect(low.rows.every((row) => row.stock_status !== "ok")).toBe(true);
      expect(search.total).toBe(1);
      expect(search.rows[0]).toMatchObject({ entries_30d: 5, last_movement_type: "ajuste_salida" });
      expect(reconciliation.code).toBeNull();
      expect(reconciliation.rows).toEqual([]);
      for (const [label, ms] of Object.entries(timings)) {
        expect([label, ms < PERF_BUDGET_MS]).toEqual([label, true]);
      }
    });
  });
});

describe("20261011a · lectura por PostgREST (la consulta de listInventory)", () => {
  it("la vista está en el esquema de PostgREST, resuelve el embed de categoría y cuenta", async () => {
    for (const role of ["admin", "almacen"] as const) {
      const client = await lab.supa(role);
      const { count, data, error } = await client
        .from("inventory_overview")
        .select(OVERVIEW_REST_SELECT, { count: "exact" })
        .eq("store_id", lab.storeId)
        .eq("is_active", true)
        .in("stock_status", ["ok", "low", "out"])
        .order("name", { ascending: true })
        .order("id", { ascending: true })
        .range(0, 9);

      expect(error).toBeNull();
      expect(typeof count).toBe("number");
      expect((data ?? []).length).toBe(Math.min(10, count ?? 0));
      expect((data ?? []).length).toBeGreaterThan(0);
    }
  });

  it.each([100_000, 2_000_000_000])("skip %d, más allá del total, es el rango no satisfacible que listInventory convierte en página vacía", async (skip) => {
    const client = await lab.supa("admin");
    const { error, status } = await client
      .from("inventory_overview")
      .select(OVERVIEW_REST_SELECT, { count: "exact" })
      .eq("store_id", lab.storeId)
      .eq("is_active", true)
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .range(skip, skip + 9);

    expect(isRangeNotSatisfiable(error, status)).toBe(true);

    const total = await client
      .from("inventory_overview")
      .select(OVERVIEW_REST_SELECT, { count: "exact", head: true })
      .eq("store_id", lab.storeId)
      .eq("is_active", true);

    expect(total.error).toBeNull();
    expect(total.count).toBeGreaterThan(0);
  });
});
