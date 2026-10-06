/**
 * Suite UI del laboratorio de stock (STK-404, plan stock-integrity §8.3).
 *
 *   npm run stock-lab:ui -- [--run <id>] [--only 1,2,5] [--headed] [--list]
 *                           [--seller vendedor1|vendedor2] [--out <dir>] [--shots <dir>]
 *
 * Maneja la app real (BFF lab en http://localhost:3100, build de producción)
 * con Playwright y compara lo que la UI dice con la base lab local.
 *
 * Salidas:
 *   <out o scripts/stock-lab/runs>/<run>/ui.jsonl | ui.md
 *   <shots o .notes/stock-integrity-gtm/qa/ui>/<run>/fNN-*.png + ui-results.json
 *
 * Exit 0 si recorrió todos los casos (aunque haya `fail`); 1 si no pudo arrancar.
 */
import { appendFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { Client } from "pg";
import { chromium, type Browser } from "playwright";

import { ApiClient } from "../../e2e-bodegon/client";
import { assertLabApiHost, labApiUrl } from "../agents/base";
import { resolveStockLabDbUrl } from "../db-test-utils";
import { assertAllowedWriteHost, loadStockLabEnv } from "../env";
import { FLOWS, prepareLab, runFlow } from "./flows";
import {
  MD_HEADER,
  countVerdicts,
  flowId,
  formatVerdictSummary,
  parseUiArgs,
  toMarkdownRow,
  type UiResult,
} from "./helpers";

const REPO_ROOT = resolve(__dirname, "..", "..", "..");

/** Chromium de Playwright; si falta el binario, Chrome o Edge del sistema. */
async function launchBrowser(headed: boolean): Promise<{ browser: Browser; name: string }> {
  const attempts: { name: string; channel?: string }[] = [
    { name: "chromium (playwright)" },
    { name: "chrome (sistema)", channel: "chrome" },
    { name: "msedge (sistema)", channel: "msedge" },
  ];
  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      const browser = await chromium.launch({
        headless: !headed,
        ...(attempt.channel ? { channel: attempt.channel } : {}),
      });
      return { browser, name: `${attempt.name} ${browser.version()}` };
    } catch (error) {
      errors.push(`${attempt.name}: ${error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error)}`);
    }
  }
  throw new Error(`No se pudo abrir ningún navegador (prueba \`npx playwright install chromium\`): ${errors.join(" | ")}`);
}

async function main(): Promise<number> {
  const args = parseUiArgs(process.argv.slice(2));
  if (args.list) {
    for (const flow of FLOWS) console.log(`${flowId(flow.n)}  ${flow.title}`);
    return 0;
  }

  const env = loadStockLabEnv();
  const baseUrl = labApiUrl().replace(/\/$/, "");
  assertLabApiHost(baseUrl, env.STOCK_TEST_ALLOW_WRITES_HOST);
  const dbUrl = resolveStockLabDbUrl();
  assertAllowedWriteHost(dbUrl, env.STOCK_TEST_ALLOW_WRITES_HOST);

  const outDir = resolve(args.out ?? join(REPO_ROOT, "scripts", "stock-lab", "runs"), args.run);
  const shotsDir = resolve(args.shots ?? join(REPO_ROOT, ".notes", "stock-integrity-gtm", "qa", "ui"), args.run);
  mkdirSync(outDir, { recursive: true });
  mkdirSync(shotsDir, { recursive: true });
  // Repetir un run id no debe mezclar capturas viejas con las nuevas.
  for (const name of readdirSync(shotsDir)) {
    if (/^f\d\d.*\.(png|txt|xlsx)$/.test(name)) rmSync(join(shotsDir, name), { force: true });
  }
  const jsonlPath = join(outDir, "ui.jsonl");
  writeFileSync(jsonlPath, "", "utf8");

  const db = new Client({ connectionString: dbUrl, connectionTimeoutMillis: 5_000 });
  await db.connect();
  const { browser, name: browserName } = await launchBrowser(args.headed);

  const results: UiResult[] = [];
  const startedAt = Date.now();
  try {
    const lab = await prepareLab({
      run: args.run,
      tag: `${args.run}-${Date.now().toString(36).slice(-4)}`,
      baseUrl,
      shotsDir,
      browser,
      db,
      admin: new ApiClient(baseUrl),
      seller: new ApiClient(baseUrl),
      sellerKey: args.seller,
      onResult: (result) => {
        results.push(result);
        appendFileSync(jsonlPath, `${JSON.stringify(result)}\n`, "utf8");
        console.log(`${result.id} ${result.verdict}`);
      },
    });
    const selected = FLOWS.filter((flow) => !args.only || args.only.includes(flow.n));
    for (const flow of selected) await runFlow(lab, flow);
  } finally {
    await browser.close().catch(() => undefined);
    await db.end().catch(() => undefined);
  }

  const counts = countVerdicts(results);
  const seconds = Math.round((Date.now() - startedAt) / 1000);
  const md = [
    `# stock-lab UI · run ${args.run}`,
    "",
    `- BFF: ${baseUrl} · navegador: ${browserName} (${args.headed ? "headed" : "headless"}) · vendedor: ${args.seller}`,
    `- Duración: ${seconds} s · ${formatVerdictSummary(counts)}`,
    `- Capturas: ${shotsDir}`,
    "",
    MD_HEADER,
    ...results.map(toMarkdownRow),
    "",
  ].join("\n");
  writeFileSync(join(outDir, "ui.md"), md, "utf8");
  writeFileSync(
    join(shotsDir, "ui-results.json"),
    JSON.stringify({ run: args.run, baseUrl, browser: browserName, seconds, counts, results }, null, 2),
    "utf8",
  );
  console.log(`ui ${args.run}: ${formatVerdictSummary(counts)} (${seconds} s)`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
