/**
 * Parseo de argumentos CLI de los agentes del laboratorio de stock (STK-302).
 *
 *   npx tsx scripts/stock-lab/agents/<x>.ts --run <id> --seed <n> [--minutes <m> | --ops <n>] [--agent <nombre>]
 *
 * `--agent` es opcional aquí: si no viene, se usa `options.defaultAgent`
 * (normalmente el nombre del archivo del agente) o, en último caso, "agent".
 */

export type AgentArgs = {
  run: string;
  seed: number;
  minutes?: number;
  ops?: number;
  agent: string;
};

export type ParseAgentArgsOptions = {
  /** Nombre del agente cuando no se pasa `--agent`. */
  defaultAgent?: string;
};

export const AGENT_ARGS_USAGE =
  "--run <id> --seed <n> [--minutes <m> | --ops <n>] [--agent <nombre>]";

const RUN_ID_RE = /^[A-Za-z0-9._-]+$/;

/**
 * El run id es el nombre de una carpeta bajo `runs/`, nunca una ruta: sin
 * separadores y sin `..` (ni `.`), para que `resolve(RUNS_DIR, runId)` no salga de `runs/`.
 */
export function assertRunId(runId: string): string {
  if (!RUN_ID_RE.test(runId) || runId.includes("..") || runId === ".") {
    throw new Error(`--run solo admite letras, números, punto, guion y guion bajo, sin ".." (recibido "${runId}").`);
  }
  return runId;
}

const KNOWN_FLAGS = new Set(["run", "seed", "minutes", "ops", "agent"]);

function parsePositiveNumber(flag: string, raw: string, integer: boolean): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) {
    throw new Error(
      `--${flag} debe ser un ${integer ? "entero" : "número"} > 0 (recibido "${raw}"). Uso: ${AGENT_ARGS_USAGE}`,
    );
  }
  return value;
}

/** Convierte `argv` (sin node/script) en un mapa flag → valor; lanza con flags desconocidas o sin valor. */
function collectFlags(argv: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] ?? "";
    if (!token.startsWith("--")) {
      throw new Error(`Argumento inesperado "${token}". Uso: ${AGENT_ARGS_USAGE}`);
    }
    let name = token.slice(2);
    let value: string | undefined;
    const eq = name.indexOf("=");
    if (eq >= 0) {
      value = name.slice(eq + 1);
      name = name.slice(0, eq);
    } else {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        value = next;
        i += 1;
      }
    }
    if (!KNOWN_FLAGS.has(name)) {
      throw new Error(`Flag desconocida --${name}. Uso: ${AGENT_ARGS_USAGE}`);
    }
    if (value === undefined || value.trim() === "") {
      throw new Error(`--${name} requiere un valor. Uso: ${AGENT_ARGS_USAGE}`);
    }
    if (flags.has(name)) {
      throw new Error(`--${name} está repetida. Uso: ${AGENT_ARGS_USAGE}`);
    }
    flags.set(name, value.trim());
  }
  return flags;
}

export function parseAgentArgs(argv: string[], options?: ParseAgentArgsOptions): AgentArgs {
  const flags = collectFlags(argv);

  const run = flags.get("run");
  if (!run) {
    throw new Error(`Falta --run <id>. Uso: ${AGENT_ARGS_USAGE}`);
  }
  const seedRaw = flags.get("seed");
  if (seedRaw === undefined) {
    throw new Error(`Falta --seed <n>. Uso: ${AGENT_ARGS_USAGE}`);
  }
  const seed = Number(seedRaw);
  if (!Number.isInteger(seed)) {
    throw new Error(`--seed debe ser un entero (recibido "${seedRaw}"). Uso: ${AGENT_ARGS_USAGE}`);
  }

  const minutesRaw = flags.get("minutes");
  const opsRaw = flags.get("ops");
  if (minutesRaw === undefined && opsRaw === undefined) {
    throw new Error(`Indica --minutes <m> o --ops <n> (al menos uno). Uso: ${AGENT_ARGS_USAGE}`);
  }

  const args: AgentArgs = {
    run: assertRunId(run),
    seed,
    agent: flags.get("agent") ?? options?.defaultAgent ?? "agent",
  };
  if (minutesRaw !== undefined) {
    args.minutes = parsePositiveNumber("minutes", minutesRaw, false);
  }
  if (opsRaw !== undefined) {
    args.ops = parsePositiveNumber("ops", opsRaw, true);
  }
  return args;
}
