/**
 * Informe de una corrida del banco de evaluación (SCN-10g).
 *
 * `renderMarkdown(result)` arma el informe legible (metas §10, global por
 * bucket, por factura, pares duplicados, "no inventar" y errores);
 * `toJson(result)` el volcado completo; `writeRunFiles(result, dir)` guarda
 * ambos en `runs/<YYYY-MM-DD>-<provider>[-n].md|.json` sin sobrescribir.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { BUCKETS, type AggregateMetrics, type Bucket, type HeaderField, type TargetCheck } from "./metrics";
import type { BenchInvoiceResult, BenchResult } from "./runner";

/** Casos del plan donde lo importante es no inventar líneas (f07 dedo, f09 recibo al lado). */
export const NO_INVENT_IDS: readonly string[] = ["f07", "f09"];

const OK = "✓";
const FAIL = "✗";
const NONE = "–";

const METRIC_LABELS: Record<string, string> = {
  headerFieldRate: "Campos de cabecera",
  linesDetectedRate: "Líneas detectadas",
  exactRate: "Cantidad/precio/total exactos",
  matchOkRate: "Emparejamiento correcto (conf. + dudosa)",
  confirmedWrongRate: "Confirmadas mal",
  p95DurationMs1Page: "p95 tiempo (1 página)",
  avgCostUsd: "Costo medio por factura",
};

const BUCKET_LABELS: Record<Bucket, string> = { sinAlias: "sin alias", conAlias: "con alias" };

// ───────────────────────── modo de la corrida (SCN-10l) ─────────────────────────

export const ORACLE_BANNER = "ORÁCULO: extracción = verdad; mide solo emparejamiento; NO es una métrica del modelo";
export const ORACLE_NA = "n/a (oráculo)";
export const FROM_ORIGINAL = "de la corrida original";

/** Métricas que con el oráculo no miden nada (lectura perfecta, 0 llamadas). */
export const ORACLE_HIDDEN_METRICS: readonly string[] = [
  "headerFieldRate",
  "linesDetectedRate",
  "exactRate",
  "p95DurationMs1Page",
  "avgCostUsd",
];

export type ReportMode =
  | { kind: "model" }
  | { kind: "oracle" }
  | { kind: "replay"; source: string; fillMissing: boolean; replayed: number; missing: number; filled: number };

const MODEL_MODE: ReportMode = { kind: "model" };

function hidden(mode: ReportMode, metric: string): boolean {
  return mode.kind === "oracle" && ORACLE_HIDDEN_METRICS.includes(metric);
}

function modeLines(mode: ReportMode): string[] {
  if (mode.kind === "oracle") {
    return [
      `> **${ORACLE_BANNER}.**`,
      "> Cabecera, líneas, exactitud, tiempo y costo: n/a (la extracción es la verdad; 0 llamadas). Few-shot no aplica.",
      "",
    ];
  }
  if (mode.kind === "replay") {
    return [
      `> **REPLAY** de ${mode.source}: extracciones guardadas reutilizadas; el emparejamiento se recalcula con el código y el lab actuales.`,
      `> Tokens, tiempo y costo: ${FROM_ORIGINAL}. Reutilizadas ${mode.replayed}, sin extracción ${mode.missing}${mode.fillMissing ? `, extraídas de nuevo (--fill-missing) ${mode.filled}` : ""}.`,
      "",
    ];
  }
  return [];
}

function pct(value: number | null): string {
  return value === null ? NONE : `${(value * 100).toFixed(1)} %`;
}

function ms(value: number | null | undefined): string {
  return value === null || value === undefined ? NONE : `${(value / 1000).toFixed(1)} s`;
}

function usd(value: number | null | undefined): string {
  return value === null || value === undefined ? NONE : `$${value.toFixed(4)}`;
}

function formatMetric(metric: string, value: number | null): string {
  if (metric === "p95DurationMs1Page") return ms(value);
  if (metric === "avgCostUsd") return usd(value);
  return pct(value);
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function row(cells: readonly string[]): string {
  return `| ${cells.map(cell).join(" | ")} |`;
}

function table(header: readonly string[], rows: readonly (readonly string[])[]): string[] {
  return [row(header), row(header.map(() => "---")), ...rows.map(row)];
}

function invoiceLabel(entry: Pick<BenchInvoiceResult, "id" | "synthetic">): string {
  return entry.synthetic ? `${entry.id} (sintética)` : entry.id;
}

function targetRows(checks: readonly TargetCheck[], mode: ReportMode = MODEL_MODE): string[][] {
  return checks.map((c) => [
    c.scope === "total" ? "total" : BUCKET_LABELS[c.scope],
    METRIC_LABELS[c.metric] ?? c.metric,
    hidden(mode, c.metric) ? ORACLE_NA : formatMetric(c.metric, c.value),
    `${c.comparator} ${formatMetric(c.metric, c.target)}`,
    hidden(mode, c.metric) ? ORACLE_NA : c.skipped ? "sin datos" : c.ok ? OK : FAIL,
  ]);
}

/** Con el oráculo solo cuentan las metas de emparejamiento. */
export function modeTargetsOk(result: Pick<BenchResult, "targets">, mode: ReportMode = MODEL_MODE): boolean {
  if (mode.kind !== "oracle") return result.targets.ok;
  return result.targets.checks.filter((c) => !hidden(mode, c.metric)).every((c) => c.skipped || c.ok);
}

function aggregateRow(scope: string, bucket: string, m: AggregateMetrics, mode: ReportMode = MODEL_MODE): string[] {
  const or = (metric: string, text: string) => (hidden(mode, metric) ? ORACLE_NA : text);
  return [
    scope,
    bucket,
    String(m.invoices),
    or("headerFieldRate", pct(m.headerFieldRate)),
    or("linesDetectedRate", pct(m.linesDetectedRate)),
    or("exactRate", pct(m.exactRate)),
    pct(m.matchOkRate),
    pct(m.confirmedWrongRate),
    `${m.duplicates.truePositive}/${m.duplicates.expected} (FP ${m.duplicates.falsePositive})`,
    or("p95DurationMs1Page", ms(m.p95DurationMs1Page)),
    or("avgCostUsd", usd(m.avgCostUsd)),
  ];
}

const HEADER_SHORT: Record<HeaderField, string> = { supplier: "P", date: "F", number: "N", total: "T" };

function headerCell(entry: BenchInvoiceResult): string {
  const fields = entry.metrics.header.fields;
  return (Object.keys(HEADER_SHORT) as HeaderField[])
    .map((field) => {
      const result = fields[field];
      return `${HEADER_SHORT[field]}${!result.evaluated ? NONE : result.ok ? OK : FAIL}`;
    })
    .join(" ");
}

function duplicateCell(entry: BenchInvoiceResult): string {
  const { expected, detected } = entry.metrics.duplicate;
  const of = entry.duplicateOfScanId ? ` (${entry.duplicateOfScanId})` : "";
  if (expected && detected) return `${OK} detectado${of}`;
  if (expected) return `${FAIL} no detectado`;
  if (detected) return `${FAIL} falso positivo${of}`;
  return NONE;
}

function invoiceRow(entry: BenchInvoiceResult): string[] {
  const { lines, exact, matching } = entry.metrics;
  const c = matching.counts;
  const tokens =
    entry.tokens.input === null && entry.tokens.output === null
      ? NONE
      : `${entry.tokens.input ?? NONE}/${entry.tokens.output ?? NONE}`;
  return [
    invoiceLabel(entry),
    BUCKET_LABELS[entry.bucket],
    entry.error ? `error${entry.error.code ? ` ${entry.error.code}` : ""}` : headerCell(entry),
    `${lines.tp}/${lines.fn}/${lines.fp}`,
    `${exact.ok}/${exact.total}`,
    `${c.confirmed_correct}/${c.doubtful_correct}/${c.confirmed_wrong + c.doubtful_wrong}/${c.unmatched}`,
    duplicateCell(entry),
    entry.reusedExtraction ? "(reutilizada)" : ms(entry.durationMs),
    tokens,
    usd(entry.costUsd),
  ];
}

export function renderMarkdown(result: BenchResult, mode: ReportMode = MODEL_MODE): string {
  const { meta } = result;
  const out: string[] = [];
  const title =
    mode.kind === "oracle"
      ? "ORÁCULO (solo emparejamiento)"
      : mode.kind === "replay"
        ? `REPLAY ${meta.provider} / ${meta.modelId}`
        : `${meta.provider} / ${meta.modelId}`;
  out.push(`# Banco de evaluación del escaneo: ${title}`);
  out.push("");
  out.push(...modeLines(mode));
  out.push(`- Fecha: ${meta.date}`);
  out.push(`- Few-shot en "con alias": ${meta.fewShot ? "sí" : "no (reutiliza la extracción sin alias)"}`);
  out.push(`- Facturas: ${meta.invoices.real} reales, ${meta.invoices.synthetic} sintéticas`);
  const targetsOk = modeTargetsOk(result, mode);
  const scopeNote = mode.kind === "oracle" ? " (solo metas de emparejamiento)" : "";
  out.push(`- Resultado global contra metas${scopeNote}: ${targetsOk ? `${OK} cumple` : `${FAIL} no cumple`}`);
  out.push("");

  out.push("## Metas (plan §10)");
  out.push("");
  out.push(...table(["Ámbito", "Métrica", "Valor", "Meta", "Resultado"], targetRows(result.targets.checks, mode)));
  out.push("");

  out.push("## Global por bucket");
  out.push("");
  const globalRows: string[][] = [];
  const scopes: [string, BenchResult["global"]["all"]][] = [
    ["todas", result.global.all],
    ["reales", result.global.real],
    ["sintéticas", result.global.synthetic],
  ];
  for (const [scope, metrics] of scopes) {
    for (const bucket of BUCKETS) globalRows.push(aggregateRow(scope, BUCKET_LABELS[bucket], metrics.byBucket[bucket], mode));
    globalRows.push(aggregateRow(scope, "total", metrics.total, mode));
  }
  out.push(
    ...table(
      [
        "Ámbito",
        "Bucket",
        "Facturas",
        "Cabecera",
        "Líneas",
        "Exactas",
        "Emparejamiento",
        "Confirmadas mal",
        "Duplicados",
        mode.kind === "replay" ? `p95 1 pág. (${FROM_ORIGINAL})` : "p95 1 pág.",
        mode.kind === "replay" ? `$ medio (${FROM_ORIGINAL})` : "$ medio",
      ],
      globalRows,
    ),
  );
  out.push("");

  out.push("## Por factura");
  out.push("");
  out.push(
    "Cabecera: P proveedor, F fecha, N número, T total. Líneas: TP/FN/FP. Emparejamiento: confirmadas ok / dudosas ok / mal / sin emparejar.",
  );
  out.push("");
  out.push(
    ...table(
      ["Factura", "Bucket", "Cabecera", "Líneas", "Exactas", "Emparejamiento", "Duplicado", "Tiempo", "Tokens in/out", "$"],
      result.perInvoice.map(invoiceRow),
    ),
  );
  out.push("");

  out.push("## Pares duplicados");
  out.push("");
  if (result.pairs.length === 0) {
    out.push("Sin pares evaluados.");
  } else {
    out.push(
      ...table(
        ["Bucket", "Par", "Detectado", "Consistente", "Cabecera distinta", "Sin par (orig./dup.)", "Valores distintos", "Emparejamiento distinto"],
        result.pairs.map((pair) => [
          BUCKET_LABELS[pair.bucket],
          `${pair.duplicateOf} / ${pair.id}`,
          pair.detected ? `${OK}${pair.detectedOf ? ` (${pair.detectedOf})` : ""}` : FAIL,
          pair.consistency.consistent ? OK : FAIL,
          pair.consistency.headerDiffs.join(", ") || NONE,
          `${pair.consistency.unpairedA.length}/${pair.consistency.unpairedB.length}`,
          String(pair.consistency.valueDiffs.length),
          String(pair.consistency.matchDiffs.length),
        ]),
      ),
    );
  }
  out.push("");

  out.push('## Casos "no inventar"');
  out.push("");
  const noInvent = result.perInvoice.filter(
    (entry) =>
      NO_INVENT_IDS.includes(entry.id) ||
      entry.metrics.lines.invented.some((line) => line.reason === "occluded_mismatch"),
  );
  if (noInvent.length === 0) {
    out.push("Sin casos en esta corrida.");
  }
  for (const entry of noInvent) {
    const invented = entry.metrics.lines.invented;
    const head = `- ${invoiceLabel(entry)} (${BUCKET_LABELS[entry.bucket]}):`;
    if (entry.error) {
      out.push(`${head} sin extracción (error).`);
    } else if (invented.length === 0) {
      out.push(`${head} ${OK} ninguna línea inventada.`);
    } else {
      out.push(`${head} ${FAIL} ${invented.length} inventada(s):`);
      for (const line of invented) {
        const why = line.reason === "occluded_mismatch" ? "línea tapada leída con confianza" : "sin línea en la verdad";
        out.push(`  - #${line.predictedIndex} "${line.rawText}" (${why})`);
      }
    }
  }
  out.push("");

  out.push("## Errores");
  out.push("");
  const errors = result.perInvoice.filter((entry) => entry.error);
  if (errors.length === 0) {
    out.push("Sin errores.");
  } else {
    for (const entry of errors) {
      const code = entry.error?.code ? ` [${entry.error.code}]` : "";
      out.push(`- ${invoiceLabel(entry)} (${BUCKET_LABELS[entry.bucket]})${code}: ${entry.error?.message ?? ""}`);
    }
  }
  out.push("");
  return out.join("\n");
}

export function toJson(result: BenchResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

function slug(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "desconocido";
}

/** Escribe `<dir>/<YYYY-MM-DD>-<provider>[-n].md|.json`; nunca sobrescribe una corrida anterior. */
export function writeRunFiles(result: BenchResult, dir: string): { markdownPath: string; jsonPath: string } {
  mkdirSync(dir, { recursive: true });
  const base = `${result.meta.date.slice(0, 10)}-${slug(result.meta.provider)}`;
  for (let n = 1; ; n += 1) {
    const name = n === 1 ? base : `${base}-${n}`;
    const markdownPath = join(dir, `${name}.md`);
    const jsonPath = join(dir, `${name}.json`);
    if (existsSync(markdownPath) || existsSync(jsonPath)) continue;
    writeFileSync(markdownPath, renderMarkdown(result), { encoding: "utf8", flag: "wx" });
    writeFileSync(jsonPath, toJson(result), { encoding: "utf8", flag: "wx" });
    return { markdownPath, jsonPath };
  }
}
