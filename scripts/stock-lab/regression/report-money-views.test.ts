/** @jest-environment node */
/**
 * REP-06a · regresión del parche `20261013a-report-money-views.sql`: los resúmenes diarios en día operativo de Caracas
 * y las vistas `report_sales_by_hour`, `report_sales_by_category`, `report_open_documents_aging`,
 * `report_open_documents_aging_summary` y `report_cash_close_differences`.
 *
 * Los datos se preparan como `postgres` dentro de una transacción que termina en `rollback`; cada lectura probada va
 * con `set local role authenticated` + `request.jwt.claims` del usuario lab (ACL y RLS de PostgREST). El último bloque
 * lee por PostgREST con los servicios reales del BFF (`moneyReports.server.ts`): confirma datos de prueba marcados con
 * `TAG` (ventas y compras sin líneas ni movimientos) y los borra al terminar.
 *
 *   npm run stock-lab:test -- scripts/stock-lab/regression/report-money-views.test.ts
 *
 * Un fallo de preparación empieza por "SETUP".
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Client } from "pg";

import { createRouteSupabaseClient } from "../../../src/lib/supabase/route-client";
import {
  buildOpenDocument,
  OPEN_PURCHASE_STATUSES,
  type OpenDocument,
} from "../../../src/modules/payments/services/openDocuments.mock-server";
import { listOpenDocuments } from "../../../src/modules/payments/services/openDocuments.server";
import { resolveAgingBucket } from "../../../src/modules/reports/services/moneyReports";
import {
  getCashCloseDifferencesReport,
  getPayablesAgingReport,
  getReceivablesAgingReport,
  getSalesByCategoryReport,
  getSalesByHourReport,
} from "../../../src/modules/reports/services/moneyReports.server";
import type { LabRoleKey } from "../agents/base";
import { withRollback } from "../db-test-utils";
import { Lab, actAs } from "../scenarios/db";

jest.mock("../../../src/lib/supabase/route-client", () => ({ createRouteSupabaseClient: jest.fn() }));

type Row = Record<string, unknown>;
type Outcome = { rows: Row[]; code: string | null; message: string; ms: number };
type Role = LabRoleKey | "anon";

const TAG = `rep06a-${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
const PATCH = resolve(__dirname, "../../../supabase/patches/20261013a-report-money-views.sql");
const INSUFFICIENT_PRIVILEGE = "42501";
/** Vista con agregados o ventanas: Postgres la rechaza por no actualizable antes de mirar privilegios. */
const NOT_UPDATABLE = "55000";
const MONEY_VIEWS = [
  "daily_sales_summary",
  "gross_profit_summary",
  "report_sales_by_hour",
  "report_sales_by_category",
  "report_open_documents_aging",
  "report_open_documents_aging_summary",
  "report_cash_close_differences",
] as const;
const BULK_DOCUMENTS = 10_000;
const BULK_PAGE = 100;
const BULK_BUDGET_MS = 2000;

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

/** Ejecuta `text` en un savepoint como el usuario lab `role` (o `anon`); devuelve el error en vez de lanzarlo. */
async function run(role: Role, text: string, params: unknown[] = []): Promise<Outcome> {
  await db.query("savepoint rep06a");
  const started = Date.now();
  try {
    await actAs(db, role === "anon" ? null : lab.uids[role]);
    const res = await db.query<Row>(text, params);
    const ms = Date.now() - started;
    await db.query("reset role");
    await db.query("release savepoint rep06a");
    return { rows: res.rows, code: null, message: "", ms };
  } catch (error) {
    await db.query("rollback to savepoint rep06a");
    await db.query("reset role");
    return { rows: [], ...failure(error), ms: Date.now() - started };
  }
}

async function read(role: Role, text: string, params: unknown[] = []): Promise<Row[]> {
  const out = await run(role, text, params);
  if (out.code) throw new Error(`lectura como ${role}: ${out.code} ${out.message}`);
  return out.rows;
}

function next(prefix: string) {
  seq += 1;
  return `${TAG}-${prefix}${seq}`;
}

async function contact(type: "cliente" | "proveedor", storeId: string = lab.storeId): Promise<string> {
  const name = next("c");
  const rows = await sql(
    `contacto ${name}`,
    "insert into public.contacts (store_id, name, type) values ($1, $2, $3::public.contact_type) returning id",
    [storeId, name, type],
  );
  return String(rows[0].id);
}

async function category(storeId: string = lab.storeId): Promise<{ id: string; name: string }> {
  const name = next("cat");
  const rows = await sql(`categoría ${name}`, "insert into public.categories (store_id, name) values ($1, $2) returning id", [
    storeId,
    name,
  ]);
  return { id: String(rows[0].id), name };
}

async function product(categoryId: string | null, storeId: string = lab.storeId): Promise<string> {
  const sku = next("p");
  const rows = await sql(
    `producto ${sku}`,
    `insert into public.products (store_id, category_id, sku, name, sale_price_ref, current_cost_ref, current_stock, min_stock)
     values ($1, $2, $3, $3, 10, 6, 0, 0) returning id`,
    [storeId, categoryId, sku],
  );
  return String(rows[0].id);
}

type SaleInput = {
  createdAt: string;
  customerId?: string;
  paidVes?: number;
  refRateVes?: number;
  status?: string;
  storeId?: string;
  totalRef?: number;
  totalVes?: number;
};

/** Venta sin movimientos de stock: `createdAt` es una expresión SQL de `timestamptz`. */
async function sale(input: SaleInput): Promise<string> {
  const number = next("s");
  const totalRef = input.totalRef ?? 10;
  const rate = input.refRateVes ?? 50;
  const totalVes = input.totalVes ?? totalRef * rate;
  const rows = await sql(
    `venta ${number}`,
    `insert into public.sales (store_id, invoice_number, customer_id, ref_rate_ves, subtotal_ref, total_ref, total_ves, paid_ves, status, created_at)
     values ($1, $2, $3, $4, $5, $5, $6, $7, $8::public.sale_status, ${input.createdAt}) returning id`,
    [
      input.storeId ?? lab.storeId,
      number,
      input.customerId ?? lab.customerId,
      rate,
      totalRef,
      totalVes,
      input.paidVes ?? totalVes,
      input.status ?? "pagada",
    ],
  );
  return String(rows[0].id);
}

async function saleItem(saleId: string, productId: string, quantity: number, price: number, cost: number): Promise<void> {
  await sql(
    "línea de venta",
    `insert into public.sale_items (sale_id, product_id, quantity, unit_price_ref, unit_cost_ref_snapshot, subtotal_ves)
     values ($1, $2, $3, $4, $5, 0)`,
    [saleId, productId, quantity, price, cost],
  );
}

type PurchaseInput = {
  createdAt: string;
  paidRef?: number;
  paidVes?: number;
  status?: string;
  storeId?: string;
  supplierId?: string;
  totalRef?: number;
  totalVes?: number;
};

async function purchase(input: PurchaseInput): Promise<string> {
  const number = next("oc");
  const totalRef = input.totalRef ?? 20;
  const totalVes = input.totalVes ?? totalRef * 50;
  const rows = await sql(
    `compra ${number}`,
    `insert into public.purchases (store_id, purchase_number, supplier_id, ref_rate_ves, subtotal_ref, total_ref, total_ves, paid_ves, paid_ref, status, created_at)
     values ($1, $2, $3, 50, $4, $4, $5, $6, $7, $8::public.purchase_status, ${input.createdAt}) returning id`,
    [
      input.storeId ?? lab.storeId,
      number,
      input.supplierId ?? lab.supplierId,
      totalRef,
      totalVes,
      input.paidVes ?? 0,
      input.paidRef ?? 0,
      input.status ?? "pedido",
    ],
  );
  return String(rows[0].id);
}

type Register = { id: string; name: string; assignedUserId: string | null };

async function registers(): Promise<Register[]> {
  const rows = await sql(
    "cajas lab",
    "select id, name, assigned_user_id from public.cash_registers where store_id = $1 order by name",
    [lab.storeId],
  );
  return rows.map((row) => ({
    assignedUserId: row.assigned_user_id === null ? null : String(row.assigned_user_id),
    id: String(row.id),
    name: String(row.name),
  }));
}

type SessionInput = {
  closedAt: string;
  counted: [ves: number | null, ref: number | null];
  expected: [ves: number | null, ref: number | null];
  openedBy: string;
  reason?: string;
  registerId: string;
  storeId?: string;
};

/** Sesión de caja ya cerrada, con el teórico y el contado tal cual los guardaría el cierre. */
async function closedSession(input: SessionInput): Promise<string> {
  const rows = await sql(
    "sesión cerrada",
    `insert into public.cash_sessions (store_id, register_id, opened_by, closed_by, status, closing_ves, closing_ref,
       theoretical_closing_ves, theoretical_closing_ref, opened_at, closed_at, closed_reason)
     values ($1, $2, $3, $3, 'closed', $4, $5, $6, $7, ${input.closedAt}::timestamptz - interval '8 hours', ${input.closedAt}, $8)
     returning id`,
    [
      input.storeId ?? lab.storeId,
      input.registerId,
      input.openedBy,
      input.counted[0],
      input.counted[1],
      input.expected[0],
      input.expected[1],
      input.reason ?? "manual",
    ],
  );
  return String(rows[0].id);
}

const daysAgo = (days: number) => `now() - interval '${days} days'`;

beforeAll(async () => {
  lab = await Lab.open("rep06a");
  db = await lab.pg();
});

afterAll(async () => {
  if (db) {
    await db.query("delete from public.sales where invoice_number like $1", [`${TAG}%`]).catch(() => undefined);
    await db.query("delete from public.purchases where purchase_number like $1", [`${TAG}%`]).catch(() => undefined);
  }
  if (lab) await lab.close();
});

describe("20261013a · forma del esquema e idempotencia", () => {
  it("el parche se puede aplicar dos veces seguidas sin error", async () => {
    const patch = readFileSync(PATCH, "utf8");

    await expect(db.query(patch)).resolves.toBeDefined();
    await expect(db.query(patch)).resolves.toBeDefined();
  });

  it("las siete vistas son security_invoker, solo lectura para authenticated / service_role y sin acceso anon", async () => {
    const rows = await sql(
      "forma",
      `select c.relname::text as view, c.relkind::text as kind, c.reloptions::text[] as options,
              has_table_privilege('authenticated', c.oid, 'select') as authenticated_reads,
              has_table_privilege('service_role', c.oid, 'select') as service_reads,
              has_table_privilege('anon', c.oid, 'select') as anon_reads,
              has_table_privilege('authenticated', c.oid, 'insert, update, delete') as authenticated_writes
       from pg_class c
       where c.relnamespace = 'public'::regnamespace and c.relname = any($1::text[])
       order by c.relname`,
      [[...MONEY_VIEWS]],
    );

    expect(rows).toEqual(
      [...MONEY_VIEWS].sort().map((view) => ({
        view,
        kind: "v",
        options: ["security_invoker=true"],
        authenticated_reads: true,
        service_reads: true,
        anon_reads: false,
        authenticated_writes: false,
      })),
    );
  });

  it("los resúmenes diarios conservan columnas y tipos, y ninguna vista depende de ellos", async () => {
    const columns = await sql(
      "columnas",
      `select table_name::text as view, string_agg(column_name || ':' || data_type, ',' order by ordinal_position) as columns
       from information_schema.columns
       where table_schema = 'public' and table_name in ('daily_sales_summary', 'gross_profit_summary')
       group by table_name order by table_name`,
    );
    const dependents = await sql(
      "dependientes",
      `select distinct dependent.relname::text as view
       from pg_depend d
       join pg_rewrite r on r.oid = d.objid
       join pg_class dependent on dependent.oid = r.ev_class
       where d.refobjid in ('public.daily_sales_summary'::regclass, 'public.gross_profit_summary'::regclass)
         and dependent.relname not in ('daily_sales_summary', 'gross_profit_summary')`,
    );

    expect(columns).toEqual([
      {
        view: "daily_sales_summary",
        columns: "store_id:uuid,sale_date:date,sales_count:bigint,total_ref:numeric,total_ves:numeric,paid_ves:numeric",
      },
      {
        view: "gross_profit_summary",
        columns: "store_id:uuid,sale_date:date,revenue_ref:numeric,cost_ref:numeric,gross_profit_ref:numeric",
      },
    ]);
    expect(dependents).toEqual([]);
  });
});

describe("20261013a · día operativo de Caracas", () => {
  // Domingo 1-mar-2020 23:30 en Caracas = lunes 2-mar-2020 03:30 UTC.
  const LATE = "timestamptz '2020-03-02 03:30:00+00'";
  // Lunes 2-mar-2020 00:10 en Caracas.
  const EARLY = "timestamptz '2020-03-02 04:10:00+00'";

  it("una venta a las 23:30 de Caracas del día D cae en D en las cuatro vistas de ventas", async () => {
    await withRollback(db, async () => {
      const cat = await category();
      const item = await product(cat.id);
      const late = await sale({ createdAt: LATE, totalRef: 12 });
      const early = await sale({ createdAt: EARLY, totalRef: 30 });
      await saleItem(late, item, 2, 6, 4);
      await saleItem(early, item, 3, 10, 4);

      const daily = await read(
        "admin",
        `select sale_date::text as day, sales_count::int as sales, total_ref::float8 as total_ref
         from public.daily_sales_summary where store_id = $1 and sale_date between '2020-02-28' and '2020-03-03' order by sale_date`,
        [lab.storeId],
      );
      const profit = await read(
        "admin",
        `select sale_date::text as day, revenue_ref::float8 as revenue, cost_ref::float8 as cost, gross_profit_ref::float8 as profit
         from public.gross_profit_summary where store_id = $1 and sale_date between '2020-02-28' and '2020-03-03' order by sale_date`,
        [lab.storeId],
      );
      const hours = await read(
        "admin",
        `select sale_date::text as day, dow, hour, sales_count::int as sales, total_ref::float8 as total_ref, total_ves::float8 as total_ves
         from public.report_sales_by_hour where store_id = $1 and sale_date between '2020-02-28' and '2020-03-03' order by sale_date, hour`,
        [lab.storeId],
      );
      const categories = await read(
        "admin",
        `select sale_date::text as day, category_name, units::int as units, revenue_ref::float8 as revenue
         from public.report_sales_by_category where store_id = $1 and sale_date between '2020-02-28' and '2020-03-03' order by sale_date`,
        [lab.storeId],
      );

      expect(daily).toEqual([
        { day: "2020-03-01", sales: 1, total_ref: 12 },
        { day: "2020-03-02", sales: 1, total_ref: 30 },
      ]);
      expect(profit).toEqual([
        { day: "2020-03-01", revenue: 12, cost: 8, profit: 4 },
        { day: "2020-03-02", revenue: 30, cost: 12, profit: 18 },
      ]);
      // 1-mar-2020 es domingo (dow 7); 2-mar-2020, lunes (dow 1).
      expect(hours).toEqual([
        { day: "2020-03-01", dow: 7, hour: 23, sales: 1, total_ref: 12, total_ves: 600 },
        { day: "2020-03-02", dow: 1, hour: 0, sales: 1, total_ref: 30, total_ves: 1500 },
      ]);
      expect(categories).toEqual([
        { day: "2020-03-01", category_name: cat.name, units: 2, revenue: 12 },
        { day: "2020-03-02", category_name: cat.name, units: 3, revenue: 30 },
      ]);
    });
  });

  it("los totales de todo el histórico no cambian: son los de las tablas base", async () => {
    await withRollback(db, async () => {
      const item = await product(null);
      for (const createdAt of [LATE, EARLY, "timestamptz '2020-03-05 23:59:59+00'", "timestamptz '2020-03-06 00:00:00+00'"]) {
        await saleItem(await sale({ createdAt, totalRef: 7.35 }), item, 3, 2.45, 1.15);
      }
      await saleItem(await sale({ createdAt: LATE, status: "cancelada", totalRef: 99 }), item, 1, 99, 1);

      const rows = await read(
        "admin",
        `select
           (select row(count(*), sum(total_ref), sum(total_ves), sum(paid_ves))::text from public.sales
             where status not in ('cancelada', 'devuelta')) as base_sales,
           (select row(sum(sales_count), sum(total_ref), sum(total_ves), sum(paid_ves))::text from public.daily_sales_summary) as daily,
           (select row(sum(sales_count), sum(total_ref), sum(total_ves))::text from public.report_sales_by_hour) as hourly,
           (select row(sum(i.subtotal_ref), sum(i.unit_cost_ref_snapshot * i.quantity), sum(i.gross_profit_ref))::text
              from public.sale_items i join public.sales s on s.id = i.sale_id
             where s.status not in ('cancelada', 'devuelta')) as base_items,
           (select row(sum(revenue_ref), sum(cost_ref), sum(gross_profit_ref))::text from public.gross_profit_summary) as profit,
           (select row(sum(revenue_ref), sum(cost_ref), sum(gross_profit_ref))::text from public.report_sales_by_category) as by_category`,
      );
      const totals = rows[0];

      expect(totals.daily).toBe(totals.base_sales);
      expect(String(totals.base_sales).startsWith(`${String(totals.hourly).slice(0, -1)},`)).toBe(true);
      expect(totals.profit).toBe(totals.base_items);
      expect(totals.by_category).toBe(totals.base_items);
    });
  });
});

describe("20261013a · ventas por categoría", () => {
  it("agrupa por la categoría del producto, deja 'Sin categoría' y cuadra día a día con gross_profit_summary", async () => {
    await withRollback(db, async () => {
      const drinks = await category();
      const snacks = await category();
      const soda = await product(drinks.id);
      const chips = await product(snacks.id);
      const loose = await product(null);
      const day = "timestamptz '2020-04-10 15:00:00+00'";
      const first = await sale({ createdAt: day, totalRef: 50 });
      const second = await sale({ createdAt: day, totalRef: 20 });
      const cancelled = await sale({ createdAt: day, status: "devuelta", totalRef: 500 });
      await saleItem(first, soda, 4, 5, 3);
      await saleItem(first, chips, 2, 7.5, 5);
      await saleItem(first, loose, 1, 15, 15);
      await saleItem(second, soda, 4, 5, 2.5);
      await saleItem(cancelled, soda, 100, 5, 1);

      const rows = await read(
        "contador",
        `select category_id::text as category_id, category_name, units::int as units, revenue_ref::float8 as revenue,
                cost_ref::float8 as cost, gross_profit_ref::float8 as profit
         from public.report_sales_by_category where store_id = $1 and sale_date = '2020-04-10' order by revenue_ref desc`,
        [lab.storeId],
      );
      const match = await read(
        "contador",
        `select
           (select row(sum(revenue_ref), sum(cost_ref), sum(gross_profit_ref))::text
              from public.report_sales_by_category where store_id = $1 and sale_date = '2020-04-10') as by_category,
           (select row(revenue_ref, cost_ref, gross_profit_ref)::text
              from public.gross_profit_summary where store_id = $1 and sale_date = '2020-04-10') as summary`,
        [lab.storeId],
      );

      expect(rows).toEqual([
        { category_id: drinks.id, category_name: drinks.name, units: 8, revenue: 40, cost: 22, profit: 18 },
        { category_id: snacks.id, category_name: snacks.name, units: 2, revenue: 15, cost: 10, profit: 5 },
        { category_id: null, category_name: "Sin categoría", units: 1, revenue: 15, cost: 15, profit: 0 },
      ]);
      expect(match[0].by_category).toBe(match[0].summary);
      expect(match[0].summary).toBe("(70.00,47.00,23.00)");
    });
  });
});

describe("20261013a · cuentas por cobrar y por pagar con antigüedad", () => {
  it("lista exactamente los documentos abiertos de Pagos, con sus saldos, días y tramo", async () => {
    await withRollback(db, async () => {
      const customer = await contact("cliente");
      const supplier = await contact("proveedor");
      const cases: Array<[label: string, days: number, totalVes: number, paidVes: number, status: string]> = [
        ["hoy", 0, 500, 0, "pendiente_pago"],
        ["borde 7", 7, 500, 120.55, "pendiente_pago"],
        ["borde 8", 8, 333.33, 100, "pendiente_pago"],
        ["borde 30", 30, 1000, 999.99, "pendiente_pago"],
        ["borde 31", 31, 780.4, 0.4, "pendiente_pago"],
        ["cobrada del todo", 40, 500, 500, "pendiente_pago"],
        ["pagada", 40, 500, 500, "pagada"],
        ["cancelada con saldo", 40, 500, 0, "cancelada"],
        ["borrador con saldo", 40, 500, 0, "borrador"],
      ];
      for (const [, days, totalVes, paidVes, status] of cases) {
        await sale({ createdAt: daysAgo(days), customerId: customer, paidVes, status, totalRef: totalVes / 50, totalVes });
      }
      const purchaseCases: Array<[days: number, totalRef: number, paidVes: number, paidRef: number, status: string]> = [
        [3, 20, 0, 0, "pedido"],
        [15, 40, 500, 10, "recibido"],
        [45, 30, 1499.99, 29.99, "recibido"],
        [45, 30, 1500, 30, "recibido"],
        [45, 30, 0, 0, "cancelado"],
        [45, 30, 0, 0, "devuelto"],
      ];
      for (const [days, totalRef, paidVes, paidRef, status] of purchaseCases) {
        await purchase({ createdAt: daysAgo(days), paidRef, paidVes, status, supplierId: supplier, totalRef });
      }

      // El criterio de Pagos (openDocuments.server.ts): mismas lecturas + `buildOpenDocument`.
      const saleRows = await read(
        "admin",
        `select id, invoice_number, status::text as status, created_at, ref_rate_ves, total_ref, total_ves, paid_ves
         from public.sales where store_id = $1 and customer_id = $2 and status = 'pendiente_pago'`,
        [lab.storeId, customer],
      );
      const purchaseRows = await read(
        "admin",
        `select id, purchase_number, status::text as status, created_at, ref_rate_ves, total_ref, total_ves, paid_ves, paid_ref
         from public.purchases where store_id = $1 and supplier_id = $2 and status = any($3::public.purchase_status[])`,
        [lab.storeId, supplier, [...OPEN_PURCHASE_STATUSES]],
      );
      const expected = [
        ...saleRows.map((row) =>
          buildOpenDocument({
            createdAt: (row.created_at as Date).toISOString(),
            id: String(row.id),
            number: String(row.invoice_number),
            paidVes: Number(row.paid_ves),
            refRateVes: Number(row.ref_rate_ves),
            status: "pendiente_pago",
            totalRef: Number(row.total_ref),
            totalVes: Number(row.total_ves),
            type: "sale",
          }),
        ),
        ...purchaseRows.map((row) =>
          buildOpenDocument({
            createdAt: (row.created_at as Date).toISOString(),
            id: String(row.id),
            number: String(row.purchase_number),
            paidRef: Number(row.paid_ref),
            paidVes: Number(row.paid_ves),
            refRateVes: Number(row.ref_rate_ves),
            status: row.status as "pedido" | "recibido",
            totalRef: Number(row.total_ref),
            totalVes: Number(row.total_ves),
            type: "purchase",
          }),
        ),
      ].filter((document): document is OpenDocument => document !== null);

      const view = await read(
        "admin",
        `select doc_type, document_id::text as id, document_number as number, contact_id::text as contact_id, contact_name,
                days, bucket, total_ref::float8 as total_ref, total_ves::float8 as total_ves, paid_ref::float8 as paid_ref,
                paid_ves::float8 as paid_ves, pending_ref::float8 as pending_ref, pending_ves::float8 as pending_ves
         from public.report_open_documents_aging
         where store_id = $1 and contact_id = any($2::uuid[])
         order by doc_type desc, created_at, document_id`,
        [lab.storeId, [customer, supplier]],
      );

      const byId = (first: { id: string }, second: { id: string }) => first.id.localeCompare(second.id);
      expect(
        view.map((row) => ({ id: String(row.id), pendingRef: row.pending_ref, pendingVes: row.pending_ves, type: row.doc_type })).sort(byId),
      ).toEqual(
        expected
          .map((document) => ({ id: document.id, pendingRef: document.pendingRef, pendingVes: document.pendingVes, type: document.type }))
          .sort(byId),
      );

      expect(view.map((row) => [row.doc_type, row.days, row.bucket, row.pending_ves, row.pending_ref, row.paid_ref])).toEqual([
        ["sale", 31, "30+", 780, 15.6, 0.01],
        ["sale", 30, "8-30", 0.01, 0, 20],
        ["sale", 8, "8-30", 233.33, 4.67, 2],
        ["sale", 7, "0-7", 379.45, 7.59, 2.41],
        ["sale", 0, "0-7", 500, 10, 0],
        ["purchase", 45, "30+", 0.01, 0.01, 29.99],
        ["purchase", 15, "8-30", 1500, 30, 10],
        ["purchase", 3, "0-7", 1000, 20, 0],
      ]);
      expect(view.every((row) => row.bucket === resolveAgingBucket(Number(row.days)))).toBe(true);
      expect(new Set(view.map((row) => row.contact_name)).size).toBe(2);

      const summary = await read(
        "admin",
        `select doc_type, bucket, documents_count::int as documents, pending_ref::float8 as pending_ref, pending_ves::float8 as pending_ves
         from public.report_open_documents_aging_summary
         where store_id = $1 and contact_id = any($2::uuid[])
         order by doc_type desc, bucket`,
        [lab.storeId, [customer, supplier]],
      );

      expect(summary).toEqual([
        { doc_type: "sale", bucket: "0-7", documents: 2, pending_ref: 17.59, pending_ves: 879.45 },
        { doc_type: "sale", bucket: "30+", documents: 1, pending_ref: 15.6, pending_ves: 780 },
        { doc_type: "sale", bucket: "8-30", documents: 2, pending_ref: 4.67, pending_ves: 233.34 },
        { doc_type: "purchase", bucket: "0-7", documents: 1, pending_ref: 20, pending_ves: 1000 },
        { doc_type: "purchase", bucket: "30+", documents: 1, pending_ref: 0.01, pending_ves: 0.01 },
        { doc_type: "purchase", bucket: "8-30", documents: 1, pending_ref: 30, pending_ves: 1500 },
      ]);
    });
  });

  it("el resumen de la tienda (contact_id null) es la suma de los resúmenes por contacto y de la lista", async () => {
    await withRollback(db, async () => {
      const customers = [await contact("cliente"), await contact("cliente")];
      for (const [index, days] of [1, 9, 20, 35, 60].entries()) {
        await sale({ createdAt: daysAgo(days), customerId: customers[index % 2], paidVes: index, status: "pendiente_pago", totalVes: 100 * (index + 1) });
      }

      const rows = await read(
        "admin",
        `select
           (select jsonb_agg(jsonb_build_array(bucket, documents_count, pending_ref, pending_ves) order by bucket)
              from public.report_open_documents_aging_summary where store_id = $1 and doc_type = 'sale' and contact_id is null) as store,
           (select jsonb_agg(jsonb_build_array(bucket, documents, pending_ref, pending_ves) order by bucket) from (
              select bucket, sum(documents_count) as documents, sum(pending_ref) as pending_ref, sum(pending_ves) as pending_ves
              from public.report_open_documents_aging_summary where store_id = $1 and doc_type = 'sale' and contact_id is not null
              group by bucket) c) as contacts,
           (select jsonb_agg(jsonb_build_array(bucket, documents, pending_ref, pending_ves) order by bucket) from (
              select bucket, count(*) as documents, sum(pending_ref) as pending_ref, sum(pending_ves) as pending_ves
              from public.report_open_documents_aging where store_id = $1 and doc_type = 'sale'
              group by bucket) d) as list`,
        [lab.storeId],
      );

      expect(rows[0].store).toEqual(rows[0].contacts);
      expect(rows[0].store).toEqual(rows[0].list);
      expect((rows[0].store as unknown[]).length).toBe(3);
    });
  });

  it(`${BULK_DOCUMENTS} documentos abiertos: se paginan completos, sin duplicados ni huecos, y el resumen cuadra`, async () => {
    await withRollback(db, async () => {
      const customer = await contact("cliente");
      // Día Caracas exacto (mediodía) para que `days` sea g % 60; g milisegundos de desempate en el orden.
      await sql(
        `${BULK_DOCUMENTS} ventas por cobrar`,
        `insert into public.sales (store_id, invoice_number, customer_id, ref_rate_ves, subtotal_ref, total_ref, total_ves, paid_ves, status, created_at)
         select $1, format('%s-b%s', $2::text, g), $3, 50, 2 + (g % 13), 2 + (g % 13), (2 + (g % 13)) * 50, g % 7, 'pendiente_pago',
                (((now() at time zone 'America/Caracas')::date - (g % 60))::timestamp + interval '12 hours'
                  + make_interval(secs => g * 0.001)) at time zone 'America/Caracas'
         from generate_series(1, $4::int) g`,
        [lab.storeId, TAG, customer, BULK_DOCUMENTS],
      );
      await sql("analyze sales", "analyze public.sales");

      const expected = new Map<string, { documents: number; pendingVes: number }>();
      for (let g = 1; g <= BULK_DOCUMENTS; g += 1) {
        const bucket = resolveAgingBucket(g % 60);
        const entry = expected.get(bucket) ?? { documents: 0, pendingVes: 0 };
        entry.documents += 1;
        entry.pendingVes += (2 + (g % 13)) * 50 - (g % 7);
        expected.set(bucket, entry);
      }

      // La consulta de getAgingReport: filtros + orden (created_at, document_id) + rango, y su conteo exacto.
      const where = "store_id = $1 and doc_type = 'sale' and contact_id = $2";
      const seen = new Set<string>();
      const timings: number[] = [];
      let previous = "";
      let ordered = true;

      for (let offset = 0; offset < BULK_DOCUMENTS + BULK_PAGE; offset += BULK_PAGE) {
        const page = await run(
          "contador",
          `select document_id::text as id, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || document_id::text as sort_key
           from public.report_open_documents_aging where ${where}
           order by created_at, document_id limit ${BULK_PAGE} offset ${offset}`,
          [lab.storeId, customer],
        );
        if (page.code) throw new Error(`página ${offset}: ${page.code} ${page.message}`);
        timings.push(page.ms);

        expect(page.rows).toHaveLength(offset < BULK_DOCUMENTS ? BULK_PAGE : 0);
        for (const row of page.rows) {
          const key = String(row.sort_key);
          ordered = ordered && key > previous;
          previous = key;
          seen.add(String(row.id));
        }
      }

      const count = await run("contador", `select count(*)::int as total from public.report_open_documents_aging where ${where}`, [
        lab.storeId,
        customer,
      ]);
      const bucketPage = await run(
        "contador",
        `select count(*)::int as total from public.report_open_documents_aging where ${where} and bucket = '8-30'`,
        [lab.storeId, customer],
      );
      const summary = await run(
        "contador",
        `select bucket, documents_count::int as documents, pending_ves::float8 as pending_ves
         from public.report_open_documents_aging_summary where store_id = $1 and doc_type = 'sale' and contact_id = $2 order by bucket`,
        [lab.storeId, customer],
      );
      const slowest = Math.max(...timings);

      console.log(
        `REP-06a · ${BULK_DOCUMENTS} documentos abiertos: ${timings.length} páginas de ${BULK_PAGE}, la más lenta ${slowest} ms; conteo ${count.ms} ms; resumen ${summary.ms} ms`,
      );

      expect(seen.size).toBe(BULK_DOCUMENTS);
      expect(ordered).toBe(true);
      expect(count.rows).toEqual([{ total: BULK_DOCUMENTS }]);
      expect(bucketPage.rows).toEqual([{ total: expected.get("8-30")!.documents }]);
      expect(summary.rows).toEqual(
        ["0-7", "30+", "8-30"].map((bucket) => ({
          bucket,
          documents: expected.get(bucket)!.documents,
          pending_ves: expected.get(bucket)!.pendingVes,
        })),
      );
      expect(summary.rows.reduce((sum, row) => sum + Number(row.documents), 0)).toBe(BULK_DOCUMENTS);
      for (const ms of [slowest, count.ms, summary.ms]) {
        expect(ms).toBeLessThan(BULK_BUDGET_MS);
      }
    });
  });
});

describe("20261013a · diferencias de cierre de caja", () => {
  it("una fila por sesión cerrada y moneda con teórico, contado, diferencia y acumulado en orden de cierre", async () => {
    await withRollback(db, async () => {
      const [first, second] = await registers();
      // Fechas de 2019: anteriores a cualquier cierre real, el acumulado empieza en ellas.
      const short = await closedSession({
        closedAt: "timestamptz '2019-06-02 03:30:00+00'",
        counted: [900, 20],
        expected: [1000.5, 20],
        openedBy: lab.uids.vendedor1,
        registerId: first.id,
      });
      const over = await closedSession({
        closedAt: "timestamptz '2019-06-02 22:00:00+00'",
        counted: [250.25, 7],
        expected: [200, 5.5],
        openedBy: lab.uids.vendedor2,
        registerId: second.id,
      });
      const auto = await closedSession({
        closedAt: "timestamptz '2019-06-03 04:00:00+00'",
        counted: [0, 0],
        expected: [-35.1, 0],
        openedBy: lab.uids.vendedor1,
        reason: "end_of_day",
        registerId: first.id,
      });
      // Sin teórico guardado (cierre anterior a que existiera la columna): no se inventa.
      await closedSession({
        closedAt: "timestamptz '2019-06-04 22:00:00+00'",
        counted: [80, 1],
        expected: [null, null],
        openedBy: lab.uids.vendedor1,
        registerId: first.id,
      });
      await sql(
        "sesión abierta",
        `insert into public.cash_sessions (store_id, register_id, opened_by, status, opening_ves, opened_at)
         values ($1, $2, $3, 'open', 50, timestamptz '2019-06-05 12:00:00+00')`,
        [lab.storeId, first.id, lab.uids.vendedor1],
      );

      const rows = await read(
        "contador",
        `select cash_session_id::text as session, register_name, close_date::text as day, closed_reason, currency,
                expected::float8 as expected, counted::float8 as counted, difference::float8 as difference,
                running_expected::float8 as running_expected, running_counted::float8 as running_counted,
                running_difference::float8 as running_difference
         from public.report_cash_close_differences
         where store_id = $1 and close_date between '2019-01-01' and '2019-12-31'
         order by currency desc, closed_at, cash_session_id`,
        [lab.storeId],
      );

      expect(rows).toEqual([
        // 03:30 UTC del 2-jun = 23:30 del 1-jun en Caracas.
        { session: short, register_name: first.name, day: "2019-06-01", closed_reason: "manual", currency: "ves", expected: 1000.5, counted: 900, difference: -100.5, running_expected: 1000.5, running_counted: 900, running_difference: -100.5 },
        { session: over, register_name: second.name, day: "2019-06-02", closed_reason: "manual", currency: "ves", expected: 200, counted: 250.25, difference: 50.25, running_expected: 1200.5, running_counted: 1150.25, running_difference: -50.25 },
        { session: auto, register_name: first.name, day: "2019-06-03", closed_reason: "end_of_day", currency: "ves", expected: -35.1, counted: 0, difference: 35.1, running_expected: 1165.4, running_counted: 1150.25, running_difference: -15.15 },
        { session: short, register_name: first.name, day: "2019-06-01", closed_reason: "manual", currency: "ref", expected: 20, counted: 20, difference: 0, running_expected: 20, running_counted: 20, running_difference: 0 },
        { session: over, register_name: second.name, day: "2019-06-02", closed_reason: "manual", currency: "ref", expected: 5.5, counted: 7, difference: 1.5, running_expected: 25.5, running_counted: 27, running_difference: 1.5 },
        { session: auto, register_name: first.name, day: "2019-06-03", closed_reason: "end_of_day", currency: "ref", expected: 0, counted: 0, difference: 0, running_expected: 25.5, running_counted: 27, running_difference: 1.5 },
      ]);

      // Filtrar un rango no corta el acumulado: la fila conserva el de toda la historia.
      const ranged = await read(
        "contador",
        `select running_difference::float8 as running_difference from public.report_cash_close_differences
         where store_id = $1 and currency = 'ves' and close_date = '2019-06-03'`,
        [lab.storeId],
      );
      expect(ranged).toEqual([{ running_difference: -15.15 }]);
    });
  });

  it("la vista no escribe: las tablas de caja quedan igual tras leerla", async () => {
    await withRollback(db, async () => {
      const [first] = await registers();
      await closedSession({
        closedAt: "timestamptz '2019-07-01 22:00:00+00'",
        counted: [10, 1],
        expected: [12, 1],
        openedBy: lab.uids.vendedor1,
        registerId: first.id,
      });
      const fingerprint = () =>
        sql(
          "huella de caja",
          `select (select count(*) || ':' || coalesce(md5(string_agg(s::text, ',' order by s.id)), '') from public.cash_sessions s) as sessions,
                  (select count(*) || ':' || coalesce(md5(string_agg(m::text, ',' order by m.id)), '') from public.cash_movements m) as movements,
                  (select count(*) || ':' || coalesce(md5(string_agg(v::text, ',' order by v.id)), '') from public.vault_movements v) as vault`,
        );
      const before = await fingerprint();

      await read("admin", "select * from public.report_cash_close_differences");

      expect(await fingerprint()).toEqual(before);
    });
  });
});

describe("20261013a · aislamiento por tienda y permisos", () => {
  it("un usuario de la tienda lab no ve en ninguna vista las filas de otra tienda", async () => {
    await withRollback(db, async () => {
      const foreignStore = lab.defaultStoreId;
      const foreignCustomer = await contact("cliente", foreignStore);
      const foreignSupplier = await contact("proveedor", foreignStore);
      const foreignCategory = await category(foreignStore);
      const foreignProduct = await product(foreignCategory.id, foreignStore);
      const foreignSale = await sale({
        createdAt: daysAgo(3),
        customerId: foreignCustomer,
        paidVes: 0,
        status: "pendiente_pago",
        storeId: foreignStore,
      });
      await saleItem(foreignSale, foreignProduct, 1, 10, 6);
      await purchase({ createdAt: daysAgo(3), storeId: foreignStore, supplierId: foreignSupplier });
      const registerRows = await sql(
        "caja ajena",
        "insert into public.cash_registers (store_id, name) values ($1, $2) returning id",
        [foreignStore, next("caja")],
      );
      await closedSession({
        closedAt: "timestamptz '2019-08-01 22:00:00+00'",
        counted: [10, 1],
        expected: [12, 1],
        openedBy: lab.uids.admin,
        registerId: String(registerRows[0].id),
        storeId: foreignStore,
      });

      for (const view of MONEY_VIEWS) {
        const asPostgres = await sql(`${view} como postgres`, `select count(*)::int as rows from public.${view} where store_id = $1`, [
          foreignStore,
        ]);
        expect([view, Number(asPostgres[0].rows) > 0]).toEqual([view, true]);

        for (const role of ["admin", "contador", "vendedor1", "almacen"] as const) {
          const seen = await read(role, `select count(*)::int as rows from public.${view} where store_id <> $1`, [lab.storeId]);
          expect([view, role, seen[0].rows]).toEqual([view, role, 0]);
        }
      }
    });
  });

  it("anon no lee ninguna vista y nadie puede escribir en ellas", async () => {
    await withRollback(db, async () => {
      for (const view of MONEY_VIEWS) {
        expect([view, (await run("anon", `select 1 from public.${view} limit 1`)).code]).toEqual([view, INSUFFICIENT_PRIVILEGE]);
        const write = await run("admin", `delete from public.${view}`);
        expect([view, [INSUFFICIENT_PRIVILEGE, NOT_UPDATABLE].includes(write.code ?? "")]).toEqual([view, true]);
      }
    });
  });

  it("quien no puede leer una sesión de caja (RLS de cash_sessions) no ve su diferencia", async () => {
    await withRollback(db, async () => {
      const [first] = await registers();
      const session = await closedSession({
        closedAt: "timestamptz '2019-09-01 22:00:00+00'",
        counted: [10, 1],
        expected: [12, 1],
        openedBy: lab.uids.vendedor1,
        registerId: first.id,
      });
      const visibleTo = async (role: LabRoleKey) =>
        (await read(role, "select count(*)::int as rows from public.report_cash_close_differences where cash_session_id = $1", [session]))[0]
          .rows;

      expect(first.assignedUserId).toBe(lab.uids.vendedor1);
      expect(await visibleTo("admin")).toBe(2);
      expect(await visibleTo("contador")).toBe(2);
      expect(await visibleTo("vendedor1")).toBe(2);
      expect(await visibleTo("vendedor2")).toBe(0);
      expect(await visibleTo("almacen")).toBe(0);
    });
  });
});

describe("20261013a · lectura por PostgREST con los servicios del BFF", () => {
  const useRole = async (role: LabRoleKey) => {
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue(await lab.supa(role));
  };

  it("las vistas están en el esquema de PostgREST y los cinco servicios responden con su forma", async () => {
    await useRole("contador");
    const range = { from: "2019-01-01", to: "2019-01-31" };

    const hours = await getSalesByHourReport(range, lab.storeId);
    const categories = await getSalesByCategoryReport(range, lab.storeId);
    const cash = await getCashCloseDifferencesReport({ from: range.from, limit: 10, skip: 0, to: range.to }, lab.storeId);
    const payables = await getPayablesAgingReport({ bucket: "30+", limit: 10, skip: 0 }, lab.storeId);

    expect(hours.matrix).toHaveLength(7);
    expect(hours.matrix.every((row) => row.length === 24)).toBe(true);
    expect(hours.totals).toEqual({ salesCount: 0, totalRef: 0, totalVes: 0 });
    expect(categories).toEqual({
      items: [],
      range,
      totals: { costRef: 0, grossProfitRef: 0, marginPct: null, markupPct: null, revenueRef: 0, units: 0 },
    });
    expect(cash).toEqual({
      items: [],
      limit: 10,
      range,
      skip: 0,
      total: 0,
      totals: [
        { counted: 0, currency: "ves", difference: 0, expected: 0, sessionsCount: 0 },
        { counted: 0, currency: "ref", difference: 0, expected: 0, sessionsCount: 0 },
      ],
    });
    expect(payables.summary.buckets.map((row) => row.bucket)).toEqual(["0-7", "8-30", "30+"]);
    expect(payables.items.every((row) => row.bucket === "30+")).toBe(true);
  });

  it("cuentas por cobrar y por pagar coinciden con GET /api/payments/open-documents sobre los mismos datos", async () => {
    const customer = String(
      (
        await sql("cliente confirmado", "insert into public.contacts (store_id, name, type) values ($1, $2, 'cliente') returning id", [
          lab.storeId,
          `${TAG} cliente PostgREST`,
        ])
      )[0].id,
    );
    const supplier = String(
      (
        await sql("proveedor confirmado", "insert into public.contacts (store_id, name, type) values ($1, $2, 'proveedor') returning id", [
          lab.storeId,
          `${TAG} proveedor PostgREST`,
        ])
      )[0].id,
    );

    try {
      for (let index = 0; index < 25; index += 1) {
        const totalVes = 100 + index * 7.35;
        await sale({
          createdAt: daysAgo(index * 2),
          customerId: customer,
          paidVes: index % 5 === 0 ? totalVes : index * 1.11,
          status: index % 6 === 0 ? "pagada" : "pendiente_pago",
          totalRef: Math.round((totalVes / 50) * 100) / 100,
          totalVes,
        });
      }
      for (let index = 0; index < 6; index += 1) {
        await purchase({
          createdAt: daysAgo(index * 9),
          paidRef: index,
          paidVes: index * 50,
          status: index === 5 ? "cancelado" : index % 2 === 0 ? "pedido" : "recibido",
          supplierId: supplier,
          totalRef: 20 + index,
        });
      }

      await useRole("admin");

      for (const [type, contactId, report] of [
        ["sale", customer, getReceivablesAgingReport],
        ["purchase", supplier, getPayablesAgingReport],
      ] as const) {
        const payments = await listOpenDocuments({ contactId, limit: 100, skip: 0, types: [type] }, lab.storeId);
        const first = await report({ contactId, limit: 10, skip: 0 }, lab.storeId);
        const second = await report({ contactId, limit: 10, skip: 10 }, lab.storeId);
        const items = [...first.items, ...second.items];

        expect(payments.totals.truncated).toBe(false);
        expect(payments.total).toBeGreaterThan(0);
        expect(first.total).toBe(payments.total);
        // Mismo orden (más antiguo primero), mismos documentos y mismos saldos.
        expect(
          items.map((row) => ({
            id: row.document.id,
            number: row.document.number,
            pendingRef: row.pendingRef,
            pendingVes: row.pendingVes,
            totalVes: row.totalVes,
          })),
        ).toEqual(
          payments.items.map((document) => ({
            id: document.id,
            number: document.number,
            pendingRef: document.pendingRef,
            pendingVes: document.pendingVes,
            totalVes: document.totalVes,
          })),
        );
        expect(first.summary.totals).toEqual({
          documentsCount: payments.totals.count,
          pendingRef: payments.totals.pendingRef,
          pendingVes: payments.totals.pendingVes,
        });
        expect(items.every((row) => row.contact?.id === contactId && row.document.href.endsWith(row.document.id))).toBe(true);

        const bucketed = await report({ bucket: "8-30", contactId, limit: 100, skip: 0 }, lab.storeId);
        expect(bucketed.total).toBe(first.summary.buckets[1].documentsCount);
        expect(bucketed.summary).toEqual(first.summary);

        // Una página más allá del total no es un error: lista vacía con el total real.
        const beyond = await report({ contactId, limit: 10, skip: 5000 }, lab.storeId);
        expect([beyond.items, beyond.total]).toEqual([[], payments.total]);
      }
    } finally {
      await db.query("delete from public.sales where customer_id = $1", [customer]);
      await db.query("delete from public.purchases where supplier_id = $1", [supplier]);
      await db.query("delete from public.contacts where id = any($1::uuid[])", [[customer, supplier]]);
    }
  });
});
