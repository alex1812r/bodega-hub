/**
 * Logica pura del oraculo de inventario (STK-202, plan stock-integrity seccion 4).
 *
 * Sin I/O: extrae los SELECT de las vistas del parche
 * `supabase/patches/20261005-stock-integrity-views.sql`, los envuelve con el
 * filtro por tienda, construye el reporte y lo formatea. `reconcile.ts` pone el
 * I/O (pg, archivos, argv).
 *
 * Contrato del parche (acordado con el coder de STK-201):
 *
 *   -- view: <nombre>
 *   create or replace view public.<nombre>
 *   with (security_invoker = true) as
 *   select ...
 *   ;
 *
 * El `;` de cierre va solo en su propia linea y cada SELECT es autonomo (no
 * referencia otras vistas del parche), asi que puede ejecutarse inline.
 */
import { assertRunId } from "./agents/cli";

export const INTEGRITY_VIEW_NAMES = [
  "stock_reconciliation",
  "stock_chain_breaks",
  "sales_without_movements",
  "purchases_without_movements",
  "movements_without_document",
  "reversal_mismatches",
  "conversion_mismatches",
  "negative_stock",
  "cross_store_movements",
] as const;

export type IntegrityViewName = (typeof INTEGRITY_VIEW_NAMES)[number];

export type IntegrityReport = Record<IntegrityViewName, number>;

function isIntegrityViewName(name: string): name is IntegrityViewName {
  return (INTEGRITY_VIEW_NAMES as readonly string[]).includes(name);
}

/**
 * Devuelve el SELECT puro de cada una de las 9 vistas (desde despues del `as`
 * hasta antes del `;` de cierre). Lanza Error con el nombre de la vista si falta
 * alguna o si su bloque no respeta el formato del contrato.
 */
export function extractViewQueries(patchSql: string): Record<IntegrityViewName, string> {
  const text = patchSql.replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const found: Partial<Record<IntegrityViewName, string>> = {};

  for (let i = 0; i < lines.length; i += 1) {
    const marker = /^\s*--\s*view:\s*([a-z_][a-z0-9_]*)\s*$/i.exec(lines[i]);
    if (!marker) continue;
    const name = marker[1];
    if (!isIntegrityViewName(name)) continue;
    if (found[name] !== undefined) {
      throw new Error(`extractViewQueries: la vista "${name}" aparece dos veces en el parche`);
    }

    // Cabecera: create or replace view public.<name> [opciones] as
    const headerStart = i + 1;
    let cursor = headerStart;
    while (cursor < lines.length && lines[cursor].trim() === "") cursor += 1;
    const createLine = lines[cursor] ?? "";
    const createRe = new RegExp(`^\\s*create\\s+or\\s+replace\\s+view\\s+public\\.${name}\\b`, "i");
    if (!createRe.test(createLine)) {
      throw new Error(
        `extractViewQueries: tras "-- view: ${name}" se esperaba "create or replace view public.${name}" (linea ${cursor + 1})`,
      );
    }

    // Buscar la linea que termina en ` as` (puede ser la misma del create o la de `with (...)`).
    let asLine = -1;
    for (let j = cursor; j < lines.length; j += 1) {
      if (/\bas\s*$/i.test(lines[j].trim())) {
        asLine = j;
        break;
      }
      if (lines[j].trim() === ";") break;
    }
    if (asLine === -1) {
      throw new Error(`extractViewQueries: la vista "${name}" no tiene un "as" cerrando la cabecera`);
    }

    // Cuerpo: desde la linea siguiente al `as` hasta la linea que es exactamente `;`.
    let endLine = -1;
    for (let j = asLine + 1; j < lines.length; j += 1) {
      if (lines[j].trim() === ";") {
        endLine = j;
        break;
      }
      if (/^\s*--\s*view:/i.test(lines[j])) break;
    }
    if (endLine === -1) {
      throw new Error(`extractViewQueries: la vista "${name}" no tiene ";" de cierre en su propia linea`);
    }
    const select = lines
      .slice(asLine + 1, endLine)
      .join("\n")
      .trim();
    if (!/^select\b/i.test(select) && !/^with\b/i.test(select)) {
      throw new Error(`extractViewQueries: el cuerpo de la vista "${name}" no empieza por select/with`);
    }
    found[name] = select;
    i = endLine;
  }

  const missing = INTEGRITY_VIEW_NAMES.filter((name) => found[name] === undefined);
  if (missing.length > 0) {
    throw new Error(`extractViewQueries: faltan vistas en el parche: ${missing.join(", ")}`);
  }
  return found as Record<IntegrityViewName, string>;
}

/**
 * Envuelve un SELECT autonomo con el filtro por tienda parametrizado ($1).
 * Nunca interpola el uuid: se pasa como parametro al driver.
 */
export function wrapWithStoreFilter(select: string, storeId: string | null): string {
  void storeId; // el valor viaja como parametro $1; aqui solo se construye el SQL
  const body = select.trim().replace(/;\s*$/, "");
  return `select * from (\n${body}\n) v where ($1::uuid is null or v.store_id = $1)`;
}

/** Variante de conteo: `select count(*)::int as n from (<select>) v where ...`. */
export function wrapWithStoreCount(select: string): string {
  const body = select.trim().replace(/;\s*$/, "");
  return `select count(*)::int as n from (\n${body}\n) v where ($1::uuid is null or v.store_id = $1)`;
}

/** Construye el reporte en el orden canonico de las 9 vistas; faltantes/no numericos -> 0. */
export function buildReportFromCounts(counts: Partial<Record<IntegrityViewName, number | string>>): IntegrityReport {
  const report = {} as IntegrityReport;
  for (const name of INTEGRITY_VIEW_NAMES) {
    const raw = counts[name];
    const n = typeof raw === "string" ? Number(raw) : raw;
    report[name] = Number.isFinite(n) ? Number(n) : 0;
  }
  return report;
}

/** Normaliza el jsonb de `stock_integrity_report` (claves = nombres de vista) a un IntegrityReport. */
export function reportFromJson(value: unknown): IntegrityReport {
  const counts: Partial<Record<IntegrityViewName, number | string>> = {};
  if (value && typeof value === "object") {
    for (const name of INTEGRITY_VIEW_NAMES) {
      const raw = (value as Record<string, unknown>)[name];
      if (typeof raw === "number" || typeof raw === "string") counts[name] = raw;
    }
  }
  return buildReportFromCounts(counts);
}

export function totalIssues(report: IntegrityReport): number {
  return INTEGRITY_VIEW_NAMES.reduce((acc, name) => acc + report[name], 0);
}

/** Tabla de texto alineada: vista | count | estado (OK si 0, FAIL si > 0). */
export function formatReportTable(report: IntegrityReport): string {
  const nameWidth = Math.max("vista".length, ...INTEGRITY_VIEW_NAMES.map((n) => n.length));
  const countWidth = Math.max("count".length, ...INTEGRITY_VIEW_NAMES.map((n) => String(report[n]).length));
  const header = `${"vista".padEnd(nameWidth)} | ${"count".padStart(countWidth)} | estado`;
  const sep = `${"-".repeat(nameWidth)}-+-${"-".repeat(countWidth)}-+-------`;
  const rows = INTEGRITY_VIEW_NAMES.map((name) => {
    const count = report[name];
    return `${name.padEnd(nameWidth)} | ${String(count).padStart(countWidth)} | ${count === 0 ? "OK" : "FAIL"}`;
  });
  const total = totalIssues(report);
  const footer = `${"total".padEnd(nameWidth)} | ${String(total).padStart(countWidth)} | ${total === 0 ? "OK" : "FAIL"}`;
  return [header, sep, ...rows, sep, footer].join("\n");
}

export type ReconcileTarget = "local" | "production";

export interface ReconcileArgs {
  runId: string | null;
  storeId: string | null;
  target: ReconcileTarget;
  readOnly: boolean;
  limit: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parsea argv (sin node/script). Lanza Error en valores invalidos. */
export function parseReconcileArgs(argv: readonly string[]): ReconcileArgs {
  const args: ReconcileArgs = { runId: null, storeId: null, target: "local", readOnly: false, limit: 20 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`Falta el valor de ${arg}`);
      i += 1;
      return value;
    };
    if (arg === "--run") args.runId = assertRunId(next());
    else if (arg === "--store") {
      const value = next();
      if (!UUID_RE.test(value)) throw new Error(`--store debe ser un uuid, recibido "${value}"`);
      args.storeId = value;
    } else if (arg === "--target") {
      const value = next();
      if (value !== "local" && value !== "production") {
        throw new Error(`--target debe ser local|production, recibido "${value}"`);
      }
      args.target = value;
    } else if (arg === "--read-only") args.readOnly = true;
    else if (arg === "--limit") {
      const value = Number(next());
      if (!Number.isInteger(value) || value < 0) throw new Error(`--limit debe ser un entero >= 0`);
      args.limit = value;
    } else throw new Error(`Argumento desconocido: ${arg}`);
  }
  return args;
}

/** Regla 1.4: contra produccion solo lectura; sin --read-only se aborta antes de conectar. */
export function assertProductionReadOnly(args: ReconcileArgs): void {
  if (args.target === "production" && !args.readOnly) {
    throw new Error(
      "--target production exige --read-only (regla 1.4: produccion es solo lectura). " +
        "No se abre ninguna conexion.",
    );
  }
}

/** run-id por defecto: YYYYMMDD-HHmmss en hora local. */
export function defaultRunId(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  );
}

/** Parser tolerante del `.env` de la raiz (mismo criterio que scripts/db-sql.mjs: ignora `# ` inicial). */
export function parseRootEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^#\s*/, "").trim();
    if (!/^[A-Z_]+=/.test(line)) continue;
    const i = line.indexOf("=");
    out[line.slice(0, i)] = line.slice(i + 1).replace(/^["']|["']$/g, "");
  }
  return out;
}

export interface ProductionCandidate {
  host: string;
  user: string;
}

/** Hosts candidatos de produccion derivados de NEXT_PUBLIC_SUPABASE_URL (como scripts/db-sql.mjs). */
export function productionCandidates(supabaseUrl: string): ProductionCandidate[] {
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  if (!projectRef) throw new Error("No se pudo derivar el projectRef de NEXT_PUBLIC_SUPABASE_URL");
  return [
    { host: "aws-0-us-west-2.pooler.supabase.com", user: `postgres.${projectRef}` },
    { host: "aws-1-us-west-2.pooler.supabase.com", user: `postgres.${projectRef}` },
    { host: `db.${projectRef}.supabase.co`, user: "postgres" },
  ];
}
