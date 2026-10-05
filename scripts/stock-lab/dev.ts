/**
 * Arranca `next dev` contra la base LOCAL del laboratorio de stock
 * (`.env.stock-lab` o, si no existe, `.env.stock-lab.example`).
 *
 *   npx tsx scripts/stock-lab/dev.ts
 *
 * Las variables del archivo stock-lab SOBREESCRIBEN `process.env`: Next no pisa
 * variables ya presentes en el entorno, así que las de `.env` / `.env.local`
 * (producción) no pueden colarse.
 */
import { spawn } from "node:child_process";

import { assertAllowedWriteHost, loadStockLabEnv } from "./env";

const REQUIRED_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "API_DATA_SOURCE",
  "NEXT_PUBLIC_API_DATA_SOURCE",
  "ALLOW_DEMO_AUTH",
  "NEXT_PUBLIC_ALLOW_DEMO_AUTH",
] as const;

const stockLabEnv = loadStockLabEnv();

const missing = REQUIRED_KEYS.filter((key) => !stockLabEnv[key]);
if (missing.length > 0) {
  throw new Error(
    `El archivo stock-lab no define: ${missing.join(", ")}. ` +
      "Sin ellas Next tomaría los valores de .env/.env.local (producción).",
  );
}

const supabaseUrl = stockLabEnv.NEXT_PUBLIC_SUPABASE_URL;
assertAllowedWriteHost(supabaseUrl, stockLabEnv.STOCK_TEST_ALLOW_WRITES_HOST);

const port = stockLabEnv.PORT ?? "3100";
const env: NodeJS.ProcessEnv = { ...process.env, ...stockLabEnv, PORT: port };

console.log(`[stock-lab] supabase=${supabaseUrl} port=${port}`);

const child = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["next", "dev", "--webpack", "-p", port],
  { stdio: "inherit", env, shell: process.platform === "win32" },
);
child.on("exit", (code) => process.exit(code ?? 0));
