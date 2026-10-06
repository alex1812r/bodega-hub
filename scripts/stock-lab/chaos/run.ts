/**
 * Runner de los casos de caos deterministas (plan stock-integrity §9, STK-411).
 *
 *   npm run stock-lab:chaos -- --case 9.1[,9.2…] | --all [--run <id>] [--repeat N] [--list] [--out <dir>]
 *
 * Escribe `<out>/<run>/chaos.jsonl` (una línea por caso/variante, se añade) y
 * regenera `<out>/<run>/chaos.md`. `<out>` por defecto = `scripts/stock-lab/runs`.
 * Exit 0 si recorrió todos los casos (aunque haya `fail`); 1 si no pudo arrancar.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  type ChaosLine,
  PLAN_CASES,
  VARIANTS,
  closeLab,
  countVerdicts,
  defaultRunId,
  formatVerdictCounts,
  openLab,
  parseChaosArgs,
  planCaseOf,
  renderChaosMarkdown,
  repeatsFor,
  runVariant,
  selectVariantIds,
  variantIds,
} from "./cases";

const DEFAULT_RUNS_DIR = resolve(__dirname, "..", "runs");

function readLines(path: string): ChaosLine[] {
  if (!existsSync(path)) return [];
  const lines: ChaosLine[] = [];
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!raw.trim()) continue;
    try {
      lines.push(JSON.parse(raw) as ChaosLine);
    } catch {
      // línea corrupta de una corrida interrumpida: se ignora
    }
  }
  return lines;
}

async function main(): Promise<number> {
  const args = parseChaosArgs(process.argv.slice(2));
  if (args.list) {
    for (const def of VARIANTS) {
      const plan = PLAN_CASES[planCaseOf(def.id)];
      console.log(`${def.id}\t${plan?.severity ?? ""}\trepeat=${def.defaultRepeat}\t${def.title}`);
    }
    return 0;
  }
  const selected = selectVariantIds(variantIds(), args);
  const runId = args.runId ?? defaultRunId(new Date(), "chaos");
  const dir = resolve(args.out ?? DEFAULT_RUNS_DIR, runId);
  mkdirSync(dir, { recursive: true });
  const jsonlPath = resolve(dir, "chaos.jsonl");
  const mdPath = resolve(dir, "chaos.md");

  const lab = await openLab(runId);
  const produced: ChaosLine[] = [];
  try {
    for (const id of selected) {
      const def = VARIANTS.find((v) => v.id === id);
      if (!def) continue;
      const line = await runVariant(lab, def, repeatsFor(def, args.repeat));
      appendFileSync(jsonlPath, `${JSON.stringify(line)}\n`);
      writeFileSync(mdPath, renderChaosMarkdown(runId, readLines(jsonlPath)));
      produced.push(line);
      console.log(`${line.id} ${line.verdict}`);
    }
  } finally {
    await closeLab(lab);
  }
  console.log(`run=${runId} ${formatVerdictCounts(countVerdicts(produced))} → ${jsonlPath}`);
  return 0;
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
