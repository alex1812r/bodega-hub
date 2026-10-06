/**
 * Escenarios deterministas del laboratorio de stock (plan stock-integrity, fase 4).
 *
 *   npm run stock-lab:scenarios -- --suite serial|oneshots|hypotheses|all
 *       [--run <id>] [--only a,b] [--list] [--out <dir de runs>]
 *
 * `serial` (STK-402) corre aquí. `oneshots` e `hypotheses` (STK-403) son CLIs
 * independientes con los mismos flags: se lanzan por subproceso y, si el
 * archivo aún no existe, se avisa en una línea y se sigue.
 *
 * Salida: una línea por caso (`id verdict`), el resumen por veredicto y
 * `runs/<run-id>/<suite>.jsonl` + `.md`. Exit 0 si recorrió todos los casos
 * (aunque haya `fail`); 1 solo si no pudo arrancar.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  CaseHarness,
  DEFAULT_RUNS_DIR,
  SuiteWriter,
  defaultScenarioRunId,
  formatSummary,
  openLabSession,
  parseScenarioArgs,
  runCase,
  selectCases,
  subSuiteArgs,
  suitesFor,
  type ScenarioArgs,
  type SuiteName,
} from "./lib";
import { buildSerialMatrix, listSerialMatrix, prepareSerialEnv, type SerialHarness } from "./serial-matrix";

const EXTERNAL_SUITES: Record<Exclude<SuiteName, "serial">, string> = {
  oneshots: resolve(__dirname, "oneshots.ts"),
  hypotheses: resolve(__dirname, "hypotheses.ts"),
};

async function runSerial(args: ScenarioArgs, runId: string): Promise<boolean> {
  const matrix = buildSerialMatrix();
  const { selected, unknown } = selectCases(matrix, args.only);
  if (args.list) {
    const wanted = new Set(selected.map((item) => item.id));
    for (const line of listSerialMatrix()) {
      if (wanted.has(line.split("\t")[0] ?? "")) console.log(line);
    }
    return true;
  }
  // Con `--suite all`, los ids de --only pueden ser de otra suite: no es un error.
  if (unknown.length > 0 && args.suite === "serial") console.log(`serial: ids desconocidos en --only: ${unknown.join(", ")}`);
  if (selected.length === 0) {
    console.log("serial: 0 casos seleccionados");
    return true;
  }
  const needsLab = selected.some((item) => item.skip === undefined);
  const session = needsLab ? await openLabSession(runId, ["admin", "vendedor1", "almacen"]) : null;
  try {
    const env = session ? await prepareSerialEnv(session) : null;
    const writer = new SuiteWriter("serial", runId, args.out ?? DEFAULT_RUNS_DIR);
    for (const def of selected) {
      const result = await runCase<SerialHarness>(def, {
        suite: "serial",
        makeHarness: (recorder, item) => {
          if (!session || !env) throw new Error("sin sesión de laboratorio");
          return { h: new CaseHarness(session, recorder, item.id), env };
        },
      });
      writer.add(result);
      console.log(`${result.id} ${result.verdict}`);
    }
    const results = writer.close();
    console.log(formatSummary("serial", results));
    console.log(`resultados: ${writer.jsonlPath}`);
    return true;
  } finally {
    await session?.close();
  }
}

function tsxCommand(): { command: string; prefix: string[]; shell: boolean } {
  try {
    return { command: process.execPath, prefix: [require.resolve("tsx/cli")], shell: false };
  } catch {
    return { command: "npx", prefix: ["tsx"], shell: true };
  }
}

function runExternal(suite: Exclude<SuiteName, "serial">, args: ScenarioArgs, runId: string): boolean {
  const file = EXTERNAL_SUITES[suite];
  if (!existsSync(file)) {
    console.log(`${suite}: ${file} aún no existe (STK-403); se omite`);
    return true;
  }
  const tsx = tsxCommand();
  const result = spawnSync(tsx.command, [...tsx.prefix, file, ...subSuiteArgs(args, runId)], { stdio: "inherit", shell: tsx.shell });
  if (result.error || result.status !== 0) {
    console.log(`${suite}: el subproceso terminó con ${result.error ? result.error.message : `exit ${String(result.status)}`}`);
    return false;
  }
  return true;
}

async function main(): Promise<number> {
  const args = parseScenarioArgs(process.argv.slice(2));
  const runId = args.runId ?? defaultScenarioRunId(new Date(), args.suite);
  let ok = true;
  for (const suite of suitesFor(args.suite)) {
    const started = suite === "serial" ? await runSerial(args, runId) : runExternal(suite, args, runId);
    ok = ok && started;
  }
  return ok ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
