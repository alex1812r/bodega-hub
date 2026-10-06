/**
 * Agente serial "mixto" del laboratorio de stock (STK-305).
 *
 *   npx tsx scripts/stock-lab/agents/mixto.ts --run <id> --seed <n> --ops <n> [--agent mixto]
 *
 * Un solo proceso: hace `setup` de los cuatro agentes (vendedor, comprador,
 * almacen, caos) con cliente, logger (`mixto-<nombre>`) y rng propios, y en
 * cada iteración elige uno con un rng maestro (vendedor 45 %, comprador 25 %,
 * almacen 20 %, caos 10 %) y llama su `step`. Al final `teardown` en orden
 * inverso. Si un agente falla en `setup` se excluye; si fallan todos, exit 1.
 *
 * Los módulos de los agentes se cargan con `import()` dinámico (tabla
 * `AGENT_MODULES`) para que este archivo compile aunque aún no existan; los
 * tests inyectan módulos falsos.
 */
import { createLabClient, fetchCatalog, runLoop, type AgentContext } from "./base";
import { parseAgentArgs, type AgentArgs } from "./cli";
import { EventLogger } from "./logger";
import { createRng, type Rng } from "./rng";

export type AgentName = "vendedor" | "comprador" | "almacen" | "caos";

export type AgentModule = {
  setup(ctx: AgentContext): Promise<void>;
  step(ctx: AgentContext): Promise<void>;
  teardown(ctx: AgentContext): Promise<void>;
};

export const AGENT_NAMES: readonly AgentName[] = ["vendedor", "comprador", "almacen", "caos"];

/** Pesos de elección por iteración (suman 100). */
export const AGENT_WEIGHTS: Record<AgentName, number> = {
  vendedor: 45,
  comprador: 25,
  almacen: 20,
  caos: 10,
};

function loadAgentModule(name: AgentName): Promise<AgentModule> {
  // Ruta no literal a propósito: TS no la resuelve en compile-time.
  const specifier = `./${name}`;
  return import(specifier) as Promise<AgentModule>;
}

export const AGENT_MODULES: Record<AgentName, () => Promise<AgentModule>> = {
  vendedor: () => loadAgentModule("vendedor"),
  comprador: () => loadAgentModule("comprador"),
  almacen: () => loadAgentModule("almacen"),
  caos: () => loadAgentModule("caos"),
};

/**
 * Elige un agente entre `available` con los pesos de AGENT_WEIGHTS
 * renormalizados (si solo quedan vendedor y caos, 45:10). Lanza si está vacío.
 */
export function pickAgent(rng: Rng, available: readonly AgentName[]): AgentName {
  if (available.length === 0) {
    throw new Error("pickAgent: no hay agentes disponibles.");
  }
  const total = available.reduce((acc, name) => acc + AGENT_WEIGHTS[name], 0);
  let roll = rng.next() * total;
  for (const name of available) {
    roll -= AGENT_WEIGHTS[name];
    if (roll < 0) return name;
  }
  return available[available.length - 1] as AgentName;
}

export type MixtoDeps = {
  modules?: Partial<Record<AgentName, () => Promise<AgentModule>>>;
  createContext?: (name: AgentName, index: number, args: AgentArgs) => AgentContext;
  /** Se usa para rellenar `ctx.catalog` tras el setup si el agente lo dejó vacío. */
  loadCatalog?: (ctx: AgentContext) => Promise<AgentContext["catalog"]>;
  log?: (line: string) => void;
};

export type MixtoResult = {
  iterations: number;
  active: AgentName[];
  setupFailures: Partial<Record<AgentName, string>>;
  teardownFailures: Partial<Record<AgentName, string>>;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function defaultCreateContext(name: AgentName, index: number, args: AgentArgs): AgentContext {
  return {
    client: createLabClient(),
    logger: new EventLogger(args.run, `${args.agent}-${name}`),
    rng: createRng(args.seed + index + 1),
    catalog: [],
    state: {},
  };
}

/** Bucle serial; devuelve iteraciones y agentes activos. Lanza si ningún agente pasa el setup. */
export async function runMixto(args: AgentArgs, deps: MixtoDeps = {}): Promise<MixtoResult> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const createContext = deps.createContext ?? defaultCreateContext;
  const loadCatalog = deps.loadCatalog ?? ((ctx: AgentContext) => fetchCatalog(ctx.client));

  const loaded: { name: AgentName; module: AgentModule; ctx: AgentContext }[] = [];
  const setupFailures: Partial<Record<AgentName, string>> = {};
  for (const [index, name] of AGENT_NAMES.entries()) {
    try {
      const loader = deps.modules?.[name] ?? AGENT_MODULES[name];
      const agentModule = await loader();
      const ctx = createContext(name, index, args);
      await agentModule.setup(ctx);
      if (ctx.catalog.length === 0) {
        ctx.catalog = await loadCatalog(ctx);
      }
      loaded.push({ name, module: agentModule, ctx });
    } catch (error) {
      setupFailures[name] = errorMessage(error);
      log(`[mixto] ${name} excluido: setup falló (${errorMessage(error)})`);
    }
  }
  if (loaded.length === 0) {
    throw new Error("mixto: ningún agente pasó el setup.");
  }

  const master = createRng(args.seed);
  const available = loaded.map((entry) => entry.name);
  const byName = new Map(loaded.map((entry) => [entry.name, entry]));
  const mainLogger = loaded[0]?.ctx.logger;
  const iterations = await runLoop(
    args,
    async () => {
      const name = pickAgent(master, available);
      const entry = byName.get(name);
      if (!entry) return;
      await entry.module.step(entry.ctx);
    },
    { logger: mainLogger },
  );

  const teardownFailures: Partial<Record<AgentName, string>> = {};
  for (const entry of [...loaded].reverse()) {
    try {
      await entry.module.teardown(entry.ctx);
    } catch (error) {
      teardownFailures[entry.name] = errorMessage(error);
      log(`[mixto] teardown de ${entry.name} falló: ${errorMessage(error)}`);
    }
  }
  return { iterations, active: available, setupFailures, teardownFailures };
}

async function main(): Promise<void> {
  const args = parseAgentArgs(process.argv.slice(2), { defaultAgent: "mixto" });
  console.log(`[mixto] run=${args.run} seed=${args.seed} ops=${args.ops ?? "-"} minutes=${args.minutes ?? "-"}`);
  const result = await runMixto(args);
  console.log(`[mixto] ${result.iterations} iteraciones con ${result.active.join(", ")}`);
  process.exit(0);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
