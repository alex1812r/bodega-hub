/** @jest-environment node */
/**
 * STK-604: modo solo lectura del oraculo (`reconcile.ts --target production
 * --read-only`). Sin base: un cliente `pg` falso registra cada sentencia.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { INTEGRITY_VIEW_NAMES, type IntegrityViewName, type ReconcileArgs, extractViewQueries } from "./integrity-views";
import {
  BEGIN_READ_ONLY,
  CHAIN_ORDER_WARNING,
  type Capabilities,
  NO_CHAIN_BREAK_LABEL,
  type QueryClient,
  ROLLBACK,
  type Row,
  assertReadOnlyStatement,
  collectReadOnlyReport,
  createReadOnlyQuery,
  formatReadOnlyMarkdown,
  integrityReportOf,
  planChecks,
  runProductionReadOnly,
  runReadOnlySession,
} from "./reconcile-readonly";

const PATCHES = resolve(__dirname, "../../supabase/patches");
const STORE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STORE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** Esquema con los parches 20261006 aplicados (lo que usan las comprobaciones v2). */
const FULL_SCHEMA: Record<string, string> = {
  products: "id store_id sku name current_stock created_at",
  stock_movements:
    "id product_id store_id type created_at quantity_delta stock_after seq sale_id purchase_id conversion_id",
  sales: "id store_id status",
  sale_items: "id sale_id product_id quantity",
  purchases: "id store_id status",
  purchase_items: "id purchase_id product_id quantity entry_mode pack_count units_per_pack",
  product_pack_conversions: "pack_product_id unit_product_id units_per_pack is_active updated_at created_at",
  stores: "id name",
};

function schemaWithout(...dropped: string[]): string[] {
  const all = Object.entries(FULL_SCHEMA).flatMap(([table, columns]) => columns.split(" ").map((c) => `${table}.${c}`));
  return all.filter((column) => !dropped.includes(column));
}

type Answer = readonly [RegExp, Row[]];

/** Cliente `pg` falso: registra las sentencias y contesta por patron. */
class FakePg implements QueryClient {
  readonly statements: string[] = [];
  ended = false;

  constructor(
    private readonly columns: readonly string[],
    private readonly views: readonly IntegrityViewName[] = [],
    private readonly answers: readonly Answer[] = [],
    private readonly readOnlySetting = "on",
  ) {}

  async query(text: string): Promise<{ rows: Row[] }> {
    this.statements.push(text);
    if (text.includes("transaction_read_only")) return { rows: [{ read_only: this.readOnlySetting }] };
    if (text.includes("information_schema.columns")) {
      return {
        rows: this.columns.map((column) => {
          const [table_name, column_name] = column.split(".");
          return { table_name, column_name };
        }),
      };
    }
    if (text.includes("information_schema.views")) return { rows: this.views.map((table_name) => ({ table_name })) };
    for (const [pattern, rows] of this.answers) if (pattern.test(text)) return { rows };
    return { rows: [] };
  }

  async end(): Promise<void> {
    this.ended = true;
  }
}

const ARGS: ReconcileArgs = { runId: null, storeId: null, target: "production", readOnly: true, limit: 5 };

function isAllowed(sql: string): boolean {
  const text = sql.trim().toLowerCase();
  return /^(select|with)\b/.test(text) || /^begin\b.*\bread only$/.test(text) || text === "rollback";
}

describe("assertReadOnlyStatement (unica puerta de sentencias)", () => {
  it.each([
    ["select 1", "select"],
    ["with x as (select 1 as a) select x.a from x", "select"],
    ["select count(*)::int as n from public.products p where p.name = 'insert; drop -- x'", "select"],
    ["BEGIN READ ONLY", "begin"],
    ["begin transaction read only", "begin"],
    [BEGIN_READ_ONLY, "begin"],
    [ROLLBACK, "rollback"],
  ])("acepta %s", (sql, kind) => {
    expect(assertReadOnlyStatement(sql)).toBe(kind);
  });

  it.each([
    "insert into public.products (name) values ('x')",
    "update public.products set current_stock = 0",
    "delete from public.stock_movements",
    "create view public.v as select 1",
    "create temp table t as select 1",
    "select * into public.copia from public.products",
    "select * from public.products for update",
    "select * from public.products for share",
    "with x as (delete from public.products returning id) select * from x",
    "with x as (insert into public.products (name) values ('x') returning id) select * from x",
    "with x as (update public.products set name = 'x' returning id) select * from x",
    "select nextval('public.stock_movements_seq')",
    "select setval('public.stock_movements_seq', 1)",
    "select set_config('transaction_read_only', 'off', true)",
    "select pg_notify('pgrst', 'reload schema')",
    "select public.stock_integrity_report(null)",
    'select "nextval"(1)',
    "select 1; drop table public.products",
    "select 1 -- comentario",
    "select /* x */ 1",
    "select $$x$$",
    "select 'sin cerrar",
    "begin",
    "begin read write",
    "begin transaction isolation level repeatable read",
    "commit",
    "set transaction read only",
    "savepoint s",
    "drop view public.stock_reconciliation",
    "alter table public.stock_movements drop column seq",
    "truncate public.stock_movements",
    "explain analyze select 1",
    "notify pgrst, 'reload schema'",
    "",
  ])("rechaza %s", (sql) => {
    expect(() => assertReadOnlyStatement(sql)).toThrow(/sentencia rechazada/);
  });

  it("createReadOnlyQuery no llega al cliente si la sentencia se rechaza", async () => {
    const fake = new FakePg(schemaWithout());
    const query = createReadOnlyQuery(fake);
    await expect(query("update public.products set current_stock = 1")).rejects.toThrow(/sentencia rechazada/);
    expect(fake.statements).toEqual([]);
  });
});

describe("las comprobaciones inline son las de las vistas", () => {
  const squash = (sql: string) => sql.replace(/\s+/g, " ").trim();
  const v1 = extractViewQueries(readFileSync(resolve(PATCHES, "20261005-stock-integrity-views.sql"), "utf8"));
  const v2Text = readFileSync(resolve(PATCHES, "20261006d-stock-integrity-views-v2.sql"), "utf8").replace(/\r\n/g, "\n");
  const V2_VIEWS: IntegrityViewName[] = [
    "stock_chain_breaks",
    "movements_without_document",
    "reversal_mismatches",
    "conversion_mismatches",
  ];

  function v2Body(name: IntegrityViewName): string {
    const match = new RegExp(
      `-- view: ${name}\\ncreate or replace view public\\.${name}\\nwith \\(security_invoker = true\\) as\\n([\\s\\S]*?)\\n;\\n`,
    ).exec(v2Text);
    if (!match) throw new Error(`el parche v2 no define ${name}`);
    return match[1];
  }

  const caps = (columns: string[]): Capabilities => ({ columns: new Set(columns), integrityViews: [] });

  it("con todas las columnas, cada SELECT es identico al de la vista vigente (v2 sobre v1)", () => {
    const plans = planChecks(caps(schemaWithout()));
    for (const name of INTEGRITY_VIEW_NAMES) {
      const expected = V2_VIEWS.includes(name) ? v2Body(name) : v1[name];
      expect({ name, sql: squash(plans[name].sql ?? "") }).toEqual({ name, sql: squash(expected) });
      expect(plans[name].degraded).toEqual([]);
    }
  });

  it("sin stock_movements.seq la cadena es la de v1 (created_at, id) y lo declara", () => {
    const plans = planChecks(caps(schemaWithout("stock_movements.seq")));
    expect(squash(plans.stock_chain_breaks.sql ?? "")).toBe(squash(v1.stock_chain_breaks));
    expect(plans.stock_chain_breaks.degraded).toEqual([`falta stock_movements.seq: ${CHAIN_ORDER_WARNING}`]);
    for (const name of INTEGRITY_VIEW_NAMES) {
      expect(plans[name].sql).not.toBeNull();
      expect(plans[name].sql).not.toMatch(/\bseq\b/);
    }
  });

  it("sin las columnas de empaque, compras se degrada a purchase_items.quantity", () => {
    const plans = planChecks(caps(schemaWithout("purchase_items.entry_mode", "purchase_items.pack_count")));
    expect(plans.purchases_without_movements.sql).toContain("pi.quantity as normalized_quantity");
    expect(plans.purchases_without_movements.sql).not.toContain("entry_mode");
    expect(plans.purchases_without_movements.degraded[0]).toContain("falta purchase_items.entry_mode, purchase_items.pack_count");
  });

  it("si falta una columna requerida la comprobacion queda no evaluable, con la columna", () => {
    const plans = planChecks(caps(schemaWithout("stock_movements.conversion_id", "product_pack_conversions.is_active")));
    expect(plans.conversion_mismatches).toEqual({
      sql: null,
      missing: ["stock_movements.conversion_id", "product_pack_conversions.is_active"],
      degraded: [],
    });
    expect(plans.stock_reconciliation.sql).not.toBeNull();
  });
});

describe("sesion de solo lectura completa (cliente falso)", () => {
  const VARIANTS: Array<[string, string[], IntegrityViewName[]]> = [
    ["con seq y con vistas", schemaWithout(), [...INTEGRITY_VIEW_NAMES]],
    ["con seq y sin vistas", schemaWithout(), []],
    ["sin seq y con vistas v1", schemaWithout("stock_movements.seq"), [...INTEGRITY_VIEW_NAMES]],
    ["sin seq y sin vistas", schemaWithout("stock_movements.seq"), []],
    [
      "sin seq, sin conversiones, sin columnas de empaque ni products.created_at",
      schemaWithout(
        "stock_movements.seq",
        "stock_movements.conversion_id",
        "purchase_items.entry_mode",
        "purchase_items.pack_count",
        "purchase_items.units_per_pack",
        "products.created_at",
        ...FULL_SCHEMA.product_pack_conversions.split(" ").map((c) => `product_pack_conversions.${c}`),
      ),
      [],
    ],
  ];
  // Toda comprobacion devuelve filas, para que tambien se emitan las consultas de muestra.
  const NOISY: Answer[] = [
    [/group by v\.store_id/, [{ store_id: STORE_A, n: 2 }]],
    [/with recon as/, [{ store_id: STORE_A, product_id: "p1", sku: "A", name: "A", current_stock: 5, ledger_stock: 3, diff: 2 }]],
  ];

  it.each(VARIANTS)("%s: solo emite BEGIN READ ONLY, SELECT y ROLLBACK", async (_label, columns, views) => {
    const fake = new FakePg(columns, views, NOISY);
    const report = await runReadOnlySession(fake, { storeId: null, limit: 5 });

    expect(fake.statements.length).toBeGreaterThan(10);
    expect(fake.statements.filter((sql) => !isAllowed(sql))).toEqual([]);
    for (const sql of fake.statements) expect(() => assertReadOnlyStatement(sql)).not.toThrow();
    expect(fake.statements[0]).toBe(BEGIN_READ_ONLY);
    expect(fake.statements[fake.statements.length - 1]).toBe(ROLLBACK);
    expect(fake.statements.filter((sql) => /^begin/i.test(sql))).toHaveLength(1);
    expect(fake.statements.filter((sql) => /^rollback/i.test(sql))).toHaveLength(1);

    // Nunca depende de objetos del parche: ni las vistas ni la funcion del oraculo.
    const objects = new RegExp(`public\\.(${INTEGRITY_VIEW_NAMES.join("|")}|stock_integrity_report)\\b`);
    expect(fake.statements.filter((sql) => objects.test(sql))).toEqual([]);

    const hasSeq = columns.includes("stock_movements.seq");
    expect(report.chainOrder).toBe(hasSeq ? "seq" : "created_at,id");
    expect(report.warnings.some((w) => w.includes(CHAIN_ORDER_WARNING))).toBe(!hasSeq);
    expect(fake.statements.some((sql) => /\bseq\b/.test(sql))).toBe(hasSeq);
    if (!hasSeq) expect(fake.statements.some((sql) => sql.includes("order by m.created_at, m.id"))).toBe(true);
    expect(report.integrityViewsPresent).toEqual(views);
  });

  it("degrada sin reventar: marca lo no evaluable y sigue con el resto", async () => {
    const [, columns] = VARIANTS[4];
    const report = await runReadOnlySession(new FakePg(columns, [], NOISY), { storeId: null, limit: 5 });
    expect(report.checks.conversion_mismatches).toMatchObject({ evaluable: false, count: null });
    expect(report.checks.conversion_mismatches.reason).toMatch(/^no evaluable: falta stock_movements\.conversion_id, /);
    expect(report.checks.purchases_without_movements.evaluable).toBe(true);
    expect(report.checks.purchases_without_movements.degraded[0]).toContain("sin normalizar empaques");
    expect(report.checks.stock_chain_breaks).toMatchObject({ evaluable: true, count: 2 });
    expect(report.total.counts.conversion_mismatches).toBeNull();
    expect(integrityReportOf(report).conversion_mismatches).toBe(0);
    expect(report.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("falta products.created_at"), expect.stringContaining("conversion_mismatches: no evaluable")]),
    );
  });

  it("sin la cadena evaluable, el primer descuadre queda como no evaluable", async () => {
    const fake = new FakePg(schemaWithout("stock_movements.stock_after"), [], NOISY);
    const report = await runReadOnlySession(fake, { storeId: null, limit: 5 });
    expect(report.checks.stock_chain_breaks.reason).toBe("no evaluable: falta stock_movements.stock_after");
    expect(report.diffProducts[0].firstMismatch).toEqual({
      kind: "not_evaluable",
      reason: "no evaluable: falta stock_movements.stock_after",
    });
  });

  it("hace ROLLBACK aunque una comprobacion falle", async () => {
    const fake = new FakePg(schemaWithout());
    const failing: QueryClient = {
      query: async (text) => {
        if (text.includes("prev_stock_after")) {
          fake.statements.push(text);
          throw new Error("canceling statement due to statement timeout");
        }
        return fake.query(text);
      },
    };
    await expect(runReadOnlySession(failing, { storeId: null, limit: 5 })).rejects.toThrow(/statement timeout/);
    expect(fake.statements[fake.statements.length - 1]).toBe(ROLLBACK);
  });

  it("aborta sin consultar nada si la transaccion no quedo READ ONLY", async () => {
    const fake = new FakePg(schemaWithout(), [], [], "off");
    await expect(runReadOnlySession(fake, { storeId: null, limit: 5 })).rejects.toThrow(/READ ONLY/);
    expect(fake.statements).toEqual([BEGIN_READ_ONLY, expect.stringContaining("transaction_read_only"), ROLLBACK]);
  });
});

describe("runProductionReadOnly", () => {
  it("sin --read-only aborta antes de conectar", async () => {
    const connect = jest.fn();
    await expect(runProductionReadOnly({ ...ARGS, readOnly: false }, connect)).rejects.toThrow(
      /--target production exige --read-only/,
    );
    expect(connect).not.toHaveBeenCalled();
  });

  it("con --read-only conecta una vez, corre la sesion y cierra el cliente", async () => {
    const fake = new FakePg(schemaWithout("stock_movements.seq"));
    const connect = jest.fn(async () => ({ client: fake, host: "db.example.invalid" }));
    const run = await runProductionReadOnly(ARGS, connect);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(run.host).toBe("db.example.invalid");
    expect(run.report.chainOrder).toBe("created_at,id");
    expect(fake.statements.filter((sql) => !isAllowed(sql))).toEqual([]);
    expect(fake.ended).toBe(true);
  });

  it("cierra el cliente aunque la sesion falle", async () => {
    const fake = new FakePg(schemaWithout(), [], [], "off");
    await expect(runProductionReadOnly(ARGS, async () => ({ client: fake, host: "h" }))).rejects.toThrow(/READ ONLY/);
    expect(fake.ended).toBe(true);
  });
});

describe("informe (plan 8.4)", () => {
  const breakAt = new Date("2026-03-02T10:00:00.000Z");
  const DETAIL: Row[] = [
    {
      product_id: "p-a1",
      store_id: STORE_A,
      sku: "A-1",
      name: "Harina | 1kg",
      current_stock: 12,
      ledger_stock: 2,
      diff: 10,
      movements_count: "4",
      last_movement_at: new Date("2026-03-05T00:00:00.000Z"),
      product_created_at: new Date("2026-01-01T00:00:00.000Z"),
      first_break_movement_id: "m-9",
      first_break_at: breakAt,
      first_break_expected_stock_after: 9,
      first_break_stock_after: 99,
    },
    {
      product_id: "p-b1",
      store_id: STORE_B,
      sku: "B-1",
      name: "Arroz",
      current_stock: 1,
      ledger_stock: 8,
      diff: -7,
      movements_count: "2",
      last_movement_at: new Date("2026-02-10T00:00:00.000Z"),
      product_created_at: new Date("2026-02-01T00:00:00.000Z"),
      first_break_movement_id: null,
      first_break_at: null,
      first_break_expected_stock_after: null,
      first_break_stock_after: null,
    },
    ...Array.from({ length: 21 }, (_, i) => ({
      product_id: `p-a-extra-${i}`,
      store_id: STORE_A,
      sku: `A-X${i}`,
      name: `Extra ${i}`,
      current_stock: 1,
      ledger_stock: 0,
      diff: 1,
      last_movement_at: null,
      product_created_at: null,
      first_break_movement_id: null,
    })),
  ];
  const ANSWERS: Answer[] = [
    [/from public\.stores/, [{ store_id: STORE_A, name: "Bodega A" }, { store_id: STORE_B, name: "Bodega B" }]],
    [/with recon as/, DETAIL],
    [/group by v\.store_id[\s\S]*$/, []],
  ];
  const chainCount: Answer = [/prev_stock_after[\s\S]*group by v\.store_id/, [{ store_id: STORE_A, n: 3 }]];
  const chainSample: Answer = [
    /store_rank[\s\S]*prev_stock_after/,
    [{ movement_id: "m-9", store_id: STORE_A, product_id: "p-a1", stock_after: 99, store_rank: "1" }],
  ];
  const salesCount: Answer = [/sale_item_id[\s\S]*group by v\.store_id/, [{ store_id: STORE_B, n: 4 }]];

  async function build() {
    const fake = new FakePg(schemaWithout("stock_movements.seq"), [], [chainCount, chainSample, salesCount, ...ANSWERS]);
    return collectReadOnlyReport(createReadOnlyQuery(fake), { storeId: null, limit: 2 });
  }

  it("cuenta, suma |diff| y ordena los peores por tienda y en total", async () => {
    const report = await build();
    expect(report.total.counts).toMatchObject({
      stock_reconciliation: 23,
      stock_chain_breaks: 3,
      sales_without_movements: 4,
      purchases_without_movements: 0,
    });
    expect(report.total.absDiffSum).toBe(10 + 7 + 21);
    expect(report.total.worst).toHaveLength(20);
    expect(report.total.worst.slice(0, 2).map((p) => [p.sku, p.currentStock, p.ledgerStock, p.diff])).toEqual([
      ["A-1", 12, 2, 10],
      ["B-1", 1, 8, -7],
    ]);
    expect(report.diffProducts).toHaveLength(23);

    const [a, b] = report.stores;
    expect([a.storeName, b.storeName]).toEqual(["Bodega A", "Bodega B"]);
    expect(a.counts).toMatchObject({ stock_reconciliation: 22, stock_chain_breaks: 3, sales_without_movements: 0 });
    expect(a.absDiffSum).toBe(31);
    expect(b.counts).toMatchObject({ stock_reconciliation: 1, stock_chain_breaks: 0, sales_without_movements: 4 });
    expect(b.absDiffSum).toBe(7);
    expect(b.worst.map((p) => p.sku)).toEqual(["B-1"]);

    // Muestras: `limit` filas por tienda, sin las columnas auxiliares.
    expect(report.rows.stock_reconciliation.map((row) => row.sku)).toEqual(["A-1", "B-1", "A-X0"]);
    expect(report.rows.stock_reconciliation[0]).not.toHaveProperty("first_break_at");
    expect(report.rows.stock_chain_breaks).toEqual([
      { movement_id: "m-9", store_id: STORE_A, product_id: "p-a1", stock_after: 99 },
    ]);
    expect(integrityReportOf(report)).toMatchObject({ stock_reconciliation: 23, stock_chain_breaks: 3 });
  });

  it("fecha el primer descuadre: rotura de cadena, o diff sin rotura con alta y ultimo movimiento", async () => {
    const report = await build();
    expect(report.diffProducts[0].firstMismatch).toEqual({
      kind: "chain_break",
      at: breakAt.toISOString(),
      movementId: "m-9",
      expectedStockAfter: 9,
      stockAfter: 99,
      order: "created_at,id",
    });
    expect(report.diffProducts[1].firstMismatch).toEqual({
      kind: "no_chain_break",
      note: NO_CHAIN_BREAK_LABEL,
      productCreatedAt: "2026-02-01T00:00:00.000Z",
      lastMovementAt: "2026-02-10T00:00:00.000Z",
    });
    expect(NO_CHAIN_BREAK_LABEL).toBe("diff sin rotura de cadena: stock escrito fuera del libro");
  });

  it("el markdown trae avisos, totales, tiendas, peores y muestras", async () => {
    const report = await build();
    const md = formatReadOnlyMarkdown(
      { runId: "r1", host: "db.example.invalid", storeId: null, generatedAt: "2026-10-06T00:00:00.000Z", limit: 2 },
      report,
    );
    expect(md).toContain("# Informe de inventario (solo lectura)");
    expect(md).toContain("- Orden de la cadena: created_at,id");
    expect(md).toContain(`- stock_chain_breaks: falta stock_movements.seq: ${CHAIN_ORDER_WARNING}`);
    expect(md).toContain("## Total");
    expect(md).toContain("- Productos con diff != 0: 23");
    expect(md).toContain("- Suma absoluta del diff: 38");
    expect(md).toContain("### Los 20 peores (por |diff|)");
    expect(md).toContain("| A-1 | Harina \\| 1kg | 12 | 2 | 10 | 2026-03-02T10:00:00.000Z: mov m-9 dejo stock_after 99, esperado 9 (orden created_at,id) |");
    expect(md).toContain(`| B-1 | Arroz | 1 | 8 | -7 | ${NO_CHAIN_BREAK_LABEL} (alta del producto 2026-02-01T00:00:00.000Z, ultimo movimiento 2026-02-10T00:00:00.000Z) |`);
    expect(md).toContain(`## Tienda: Bodega A (${STORE_A})`);
    expect(md).toContain(`## Tienda: Bodega B (${STORE_B})`);
    expect(md).toContain("### Muestra de stock_chain_breaks (3 filas, mostrando 1)");
    expect(md).toContain("- Ventas sin movimiento (lineas): 4");
  });
});
