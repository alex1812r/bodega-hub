/**
 * Arranca el BFF contra la base LOCAL del laboratorio de stock
 * (`.env.stock-lab` o, si no existe, `.env.stock-lab.example`).
 *
 *   npx tsx scripts/stock-lab/dev.ts                    # next dev --webpack
 *   npx tsx scripts/stock-lab/dev.ts --start            # next build + next start
 *   npx tsx scripts/stock-lab/dev.ts --start --no-build # next start sobre el build existente
 *
 * Las variables del archivo stock-lab SOBREESCRIBEN `process.env`: Next no pisa
 * variables ya presentes en el entorno, así que las de `.env` / `.env.local`
 * (producción) no pueden colarse. En modo producción esto importa también en
 * el BUILD: `next build` inlinea las `NEXT_PUBLIC_*` en el bundle, por eso el
 * build se lanza con el mismo entorno lab y después se revisa el bundle
 * (`inspectBundleText`) antes de servirlo.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { assertAllowedWriteHost, loadStockLabEnv } from "./env";

export const REQUIRED_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "API_DATA_SOURCE",
  "NEXT_PUBLIC_API_DATA_SOURCE",
  "ALLOW_DEMO_AUTH",
  "NEXT_PUBLIC_ALLOW_DEMO_AUTH",
] as const;

export const DEFAULT_LAB_PORT = "3100";

export type LabServerMode = "dev" | "start";

export type LabServerArgs = {
  mode: LabServerMode;
  /** Solo aplica a `start`: false = reutilizar `.next` (flag `--no-build`). */
  build: boolean;
};

export type LabServerStep = {
  name: "dev" | "build" | "start";
  args: string[];
};

export type LabServerEnv = {
  supabaseUrl: string;
  port: string;
  env: Record<string, string | undefined>;
};

/** `--start` (o `--mode start`) elige producción; `--no-build` solo vale con él. */
export function parseLabServerArgs(argv: readonly string[]): LabServerArgs {
  let mode: LabServerMode = "dev";
  let build = true;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--start") {
      mode = "start";
    } else if (arg === "--dev") {
      mode = "dev";
    } else if (arg === "--mode" || arg.startsWith("--mode=")) {
      const value = arg === "--mode" ? argv[(i += 1)] : arg.slice("--mode=".length);
      if (value !== "dev" && value !== "start") {
        throw new Error(`--mode debe ser "dev" o "start" (recibido: ${value ?? "nada"}).`);
      }
      mode = value;
    } else if (arg === "--no-build") {
      build = false;
    } else {
      throw new Error(
        `Argumento desconocido: ${arg}. Uso: dev.ts [--start [--no-build]]`,
      );
    }
  }

  if (!build && mode !== "start") {
    throw new Error("--no-build solo tiene sentido con --start.");
  }
  return { mode, build: mode === "start" ? build : false };
}

/**
 * Valida el entorno lab (claves obligatorias + host permitido) y lo mezcla
 * sobre `baseEnv` de forma que las variables lab siempre ganan.
 */
export function resolveLabServerEnv(
  stockLabEnv: Record<string, string>,
  baseEnv: Record<string, string | undefined> = {},
): LabServerEnv {
  const missing = REQUIRED_KEYS.filter((key) => !stockLabEnv[key]);
  if (missing.length > 0) {
    throw new Error(
      `El archivo stock-lab no define: ${missing.join(", ")}. ` +
        "Sin ellas Next tomaría los valores de .env/.env.local (producción).",
    );
  }

  const supabaseUrl = stockLabEnv.NEXT_PUBLIC_SUPABASE_URL;
  assertAllowedWriteHost(supabaseUrl, stockLabEnv.STOCK_TEST_ALLOW_WRITES_HOST);

  const port = stockLabEnv.PORT || DEFAULT_LAB_PORT;
  return {
    supabaseUrl,
    port,
    env: { ...baseEnv, ...stockLabEnv, PORT: port },
  };
}

/** Comandos `next …` (sin el `npx`) que hay que ejecutar, en orden. */
export function resolveLabServerSteps(
  args: LabServerArgs,
  port: string,
): LabServerStep[] {
  if (args.mode === "dev") {
    return [{ name: "dev", args: ["next", "dev", "--webpack", "-p", port] }];
  }
  const start: LabServerStep = { name: "start", args: ["next", "start", "-p", port] };
  return args.build
    ? [{ name: "build", args: ["next", "build"] }, start]
    : [start];
}

// Referencia de proyecto de Supabase Cloud (`<ref>.supabase.co`): si aparece en
// el bundle, el build se hizo con el entorno equivocado.
const SUPABASE_CLOUD_HOST = /\b[a-z0-9]{15,}\.supabase\.(?:co|in|net)\b/gi;

export type BundleInspection = {
  hasLabUrl: boolean;
  foreignHosts: string[];
};

/** Busca en un trozo de bundle la URL lab y hosts de Supabase Cloud ajenos. */
export function inspectBundleText(text: string, labSupabaseUrl: string): BundleInspection {
  const foreign = new Set<string>();
  for (const match of text.matchAll(SUPABASE_CLOUD_HOST)) {
    foreign.add(match[0].toLowerCase());
  }
  return {
    hasLabUrl: text.includes(labSupabaseUrl),
    foreignHosts: [...foreign].sort(),
  };
}

function listBundleFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listBundleFiles(full));
    else if (/\.(js|mjs|cjs|json|html|rsc)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Revisa `.next/static` y `.next/server`: el bundle debe contener la URL lab y
 * ningún host de Supabase Cloud. Lanza si el build no existe o no es del lab.
 */
export function assertBuildTargetsLab(distDir: string, labSupabaseUrl: string): number {
  if (!existsSync(join(distDir, "BUILD_ID"))) {
    throw new Error(
      `No hay build de producción en ${distDir}. Corre \`npm run stock-lab:start\` sin --no-build.`,
    );
  }
  const files = [
    ...listBundleFiles(join(distDir, "static")),
    ...listBundleFiles(join(distDir, "server")),
  ];
  let hasLabUrl = false;
  const foreign = new Set<string>();
  for (const file of files) {
    const result = inspectBundleText(readFileSync(file, "utf8"), labSupabaseUrl);
    hasLabUrl ||= result.hasLabUrl;
    for (const host of result.foreignHosts) foreign.add(host);
  }
  if (foreign.size > 0) {
    throw new Error(
      `El build en ${distDir} referencia hosts de Supabase que no son el lab: ` +
        `${[...foreign].join(", ")}. Me niego a servirlo; recompila con \`npm run stock-lab:start\`.`,
    );
  }
  if (!hasLabUrl) {
    throw new Error(
      `El build en ${distDir} no contiene ${labSupabaseUrl}: no se compiló con el entorno lab. ` +
        "Recompila con `npm run stock-lab:start`.",
    );
  }
  return files.length;
}

function runStep(step: LabServerStep, env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolveExit, reject) => {
    const child = spawn(process.platform === "win32" ? "npx.cmd" : "npx", step.args, {
      stdio: "inherit",
      env,
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("exit", (code) => resolveExit(code ?? 0));
  });
}

async function main(): Promise<void> {
  const args = parseLabServerArgs(process.argv.slice(2));
  const { supabaseUrl, port, env } = resolveLabServerEnv(loadStockLabEnv(), process.env);
  const distDir = resolve(__dirname, "..", "..", ".next");

  console.log(
    `[stock-lab] modo=${args.mode}${args.mode === "start" ? ` build=${args.build}` : ""} ` +
      `supabase=${supabaseUrl} port=${port}`,
  );

  for (const step of resolveLabServerSteps(args, port)) {
    if (step.name === "start") {
      const files = assertBuildTargetsLab(distDir, supabaseUrl);
      console.log(`[stock-lab] build verificado (${files} archivos): solo ${supabaseUrl}`);
    }
    const startedAt = Date.now();
    const code = await runStep(step, env as NodeJS.ProcessEnv);
    if (step.name === "build") {
      const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(`[stock-lab] next build terminó con código ${code} en ${seconds}s`);
    }
    if (code !== 0 || step.name !== "build") {
      process.exit(code);
    }
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
