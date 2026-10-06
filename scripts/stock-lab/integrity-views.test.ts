/** @jest-environment node */
import {
  INTEGRITY_VIEW_NAMES,
  assertProductionReadOnly,
  buildReportFromCounts,
  defaultRunId,
  extractViewQueries,
  formatReportTable,
  parseReconcileArgs,
  parseRootEnv,
  productionCandidates,
  reportFromJson,
  totalIssues,
  wrapWithStoreCount,
  wrapWithStoreFilter,
} from "./integrity-views";

const REAL_SELECTS: Partial<Record<(typeof INTEGRITY_VIEW_NAMES)[number], string>> = {
  stock_reconciliation: [
    "select p.store_id, p.id as product_id, p.current_stock,",
    "  coalesce(sum(m.quantity_delta), 0) as ledger_stock,",
    "  p.current_stock - coalesce(sum(m.quantity_delta), 0) as diff",
    "from public.products p",
    "left join public.stock_movements m on m.product_id = p.id",
    "group by p.store_id, p.id, p.current_stock",
    "having p.current_stock <> coalesce(sum(m.quantity_delta), 0)",
  ].join("\n"),
  negative_stock: "select store_id, id as product_id, current_stock\nfrom public.products\nwhere current_stock < 0",
  cross_store_movements: [
    "with docs as (select id, store_id from public.sales)",
    "select m.store_id, m.id as movement_id",
    "from public.stock_movements m join docs d on d.id = m.sale_id",
    "where d.store_id <> m.store_id",
  ].join("\n"),
};

function viewBlock(name: string, select: string): string {
  return [
    `-- view: ${name}`,
    `create or replace view public.${name}`,
    "with (security_invoker = true) as",
    select,
    ";",
    "",
  ].join("\n");
}

function buildPatch(options: { omit?: string; dropClosing?: string } = {}): string {
  const parts = ["-- parche de prueba", "", "-- function: stock_integrity_report", ""];
  for (const name of INTEGRITY_VIEW_NAMES) {
    if (name === options.omit) continue;
    const select = REAL_SELECTS[name] ?? `select null::uuid as store_id\nwhere false`;
    let block = viewBlock(name, select);
    if (name === options.dropClosing) block = block.replace("\n;\n", "\n");
    parts.push(block);
  }
  parts.push(
    "create or replace function public.stock_integrity_report(p_store_id uuid default null)",
    "returns jsonb language sql stable as $$",
    "  select jsonb_build_object('negative_stock', (select count(*) from public.negative_stock where p_store_id is null or store_id = p_store_id));",
    "$$;",
    "",
    "notify pgrst, 'reload schema';",
  );
  return parts.join("\n");
}

describe("extractViewQueries", () => {
  it("devuelve el SELECT puro de las 9 vistas", () => {
    const queries = extractViewQueries(buildPatch());
    expect(Object.keys(queries).sort()).toEqual([...INTEGRITY_VIEW_NAMES].sort());
    expect(queries.stock_reconciliation).toBe(REAL_SELECTS.stock_reconciliation);
    expect(queries.negative_stock).toBe(REAL_SELECTS.negative_stock);
    expect(queries.cross_store_movements).toBe(REAL_SELECTS.cross_store_movements);
    expect(queries.stock_chain_breaks).toBe("select null::uuid as store_id\nwhere false");
    for (const name of INTEGRITY_VIEW_NAMES) {
      expect(queries[name]).not.toMatch(/create or replace/i);
      expect(queries[name]).not.toMatch(/;\s*$/);
    }
  });

  it("tolera CRLF", () => {
    const queries = extractViewQueries(buildPatch().replace(/\n/g, "\r\n"));
    expect(queries.negative_stock).toBe(REAL_SELECTS.negative_stock);
  });

  it("lanza con el nombre de la vista que falta", () => {
    expect(() => extractViewQueries(buildPatch({ omit: "reversal_mismatches" }))).toThrow(
      /faltan vistas.*reversal_mismatches/,
    );
  });

  it("lanza si una vista no tiene el ; de cierre en su propia linea", () => {
    expect(() => extractViewQueries(buildPatch({ dropClosing: "conversion_mismatches" }))).toThrow(
      /conversion_mismatches.*";" de cierre/,
    );
  });

  it("lanza si el marcador no va seguido del create or replace view", () => {
    const broken = buildPatch().replace(
      "create or replace view public.negative_stock",
      "create view public.negative_stock",
    );
    expect(() => extractViewQueries(broken)).toThrow(/negative_stock/);
  });
});

describe("wrapWithStoreFilter / wrapWithStoreCount", () => {
  it("envuelve el select con el filtro parametrizado sin interpolar el uuid", () => {
    const storeId = "11111111-2222-3333-4444-555555555555";
    const sql = wrapWithStoreFilter("select store_id from public.products;", storeId);
    expect(sql).toBe(
      "select * from (\nselect store_id from public.products\n) v where ($1::uuid is null or v.store_id = $1)",
    );
    expect(sql).not.toContain(storeId);
    expect(wrapWithStoreFilter("select 1 as store_id", null)).toContain("$1::uuid is null");
  });

  it("variante count", () => {
    expect(wrapWithStoreCount("select 1 as store_id")).toBe(
      "select count(*)::int as n from (\nselect 1 as store_id\n) v where ($1::uuid is null or v.store_id = $1)",
    );
  });
});

describe("buildReportFromCounts / reportFromJson / totalIssues", () => {
  it("rellena las 9 claves en orden canonico y convierte strings", () => {
    const report = buildReportFromCounts({ negative_stock: "3", stock_chain_breaks: 2 });
    expect(Object.keys(report)).toEqual([...INTEGRITY_VIEW_NAMES]);
    expect(report.negative_stock).toBe(3);
    expect(report.stock_chain_breaks).toBe(2);
    expect(report.stock_reconciliation).toBe(0);
    expect(totalIssues(report)).toBe(5);
  });

  it("reportFromJson ignora claves extra y valores no numericos", () => {
    const report = reportFromJson({ negative_stock: 1, otra: 9, cross_store_movements: null });
    expect(report.negative_stock).toBe(1);
    expect(report.cross_store_movements).toBe(0);
    expect(reportFromJson(null).negative_stock).toBe(0);
  });
});

describe("formatReportTable", () => {
  it("alinea columnas y marca OK/FAIL", () => {
    const report = buildReportFromCounts({ negative_stock: 12 });
    const table = formatReportTable(report);
    const lines = table.split("\n");
    expect(lines[0]).toBe("vista                       | count | estado");
    expect(lines).toContain("negative_stock              |    12 | FAIL");
    expect(lines).toContain("stock_reconciliation        |     0 | OK");
    expect(lines[lines.length - 1]).toBe("total                       |    12 | FAIL");
    expect(formatReportTable(buildReportFromCounts({}))).toMatch(/total\s+\|\s+0 \| OK$/);
  });
});

describe("parseReconcileArgs / assertProductionReadOnly", () => {
  it("defaults", () => {
    expect(parseReconcileArgs([])).toEqual({ runId: null, storeId: null, target: "local", readOnly: false, limit: 20 });
  });

  it("parsea todas las opciones", () => {
    const args = parseReconcileArgs([
      "--run", "stk202", "--store", "11111111-2222-3333-4444-555555555555", "--target", "production", "--read-only", "--limit", "5",
    ]);
    expect(args).toEqual({
      runId: "stk202",
      storeId: "11111111-2222-3333-4444-555555555555",
      target: "production",
      readOnly: true,
      limit: 5,
    });
  });

  it("rechaza valores invalidos", () => {
    expect(() => parseReconcileArgs(["--store", "abc"])).toThrow(/uuid/);
    expect(() => parseReconcileArgs(["--target", "staging"])).toThrow(/local\|production/);
    expect(() => parseReconcileArgs(["--limit", "-1"])).toThrow(/--limit/);
    expect(() => parseReconcileArgs(["--run"])).toThrow(/Falta el valor/);
    expect(() => parseReconcileArgs(["--foo"])).toThrow(/desconocido/);
  });

  it("production sin --read-only aborta; con --read-only pasa; local no lo exige", () => {
    expect(() => assertProductionReadOnly(parseReconcileArgs(["--target", "production"]))).toThrow(/--read-only/);
    expect(() => assertProductionReadOnly(parseReconcileArgs(["--target", "production", "--read-only"]))).not.toThrow();
    expect(() => assertProductionReadOnly(parseReconcileArgs([]))).not.toThrow();
  });
});

describe("defaultRunId / parseRootEnv / productionCandidates", () => {
  it("run-id con formato YYYYMMDD-HHmmss", () => {
    expect(defaultRunId(new Date(2026, 9, 5, 7, 8, 9))).toBe("20261005-070809");
  });

  it("parseRootEnv tolera lineas comentadas y comillas como db-sql.mjs", () => {
    const env = parseRootEnv('# NEXT_PUBLIC_SUPABASE_URL="https://abc.supabase.co"\nSUPABASE_DB_PASS=\'x\'\n# nota\nfoo=bar\n');
    expect(env).toEqual({ NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co", SUPABASE_DB_PASS: "x" });
  });

  it("productionCandidates deriva el projectRef", () => {
    expect(productionCandidates("https://abcdef.supabase.co")).toEqual([
      { host: "aws-0-us-west-2.pooler.supabase.com", user: "postgres.abcdef" },
      { host: "aws-1-us-west-2.pooler.supabase.com", user: "postgres.abcdef" },
      { host: "db.abcdef.supabase.co", user: "postgres" },
    ]);
  });
});
