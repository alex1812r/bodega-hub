import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentContext } from "./base";
import { EventLogger, readEvents } from "./logger";
import { AGENT_NAMES, AGENT_WEIGHTS, pickAgent, runMixto, type AgentModule, type AgentName } from "./mixto";
import { createRng } from "./rng";

describe("pickAgent", () => {
  it("respeta los pesos 45/25/20/10 con 1000 muestras (±5 %)", () => {
    const rng = createRng(2026);
    const counts: Record<AgentName, number> = { vendedor: 0, comprador: 0, almacen: 0, caos: 0 };
    const samples = 1000;
    for (let i = 0; i < samples; i += 1) {
      counts[pickAgent(rng, AGENT_NAMES)] += 1;
    }
    for (const name of AGENT_NAMES) {
      const share = counts[name] / samples;
      expect(Math.abs(share - AGENT_WEIGHTS[name] / 100)).toBeLessThanOrEqual(0.05);
    }
  });

  it("renormaliza entre los disponibles y nunca elige uno excluido", () => {
    const rng = createRng(7);
    const counts = { vendedor: 0, caos: 0 };
    for (let i = 0; i < 1000; i += 1) {
      const picked = pickAgent(rng, ["vendedor", "caos"]);
      expect(["vendedor", "caos"]).toContain(picked);
      counts[picked as "vendedor" | "caos"] += 1;
    }
    expect(Math.abs(counts.vendedor / 1000 - 45 / 55)).toBeLessThanOrEqual(0.05);
    expect(pickAgent(rng, ["almacen"])).toBe("almacen");
    expect(() => pickAgent(rng, [])).toThrow(/no hay agentes/);
  });

  it("es determinista por semilla", () => {
    const a = createRng(99);
    const b = createRng(99);
    const seqA = Array.from({ length: 20 }, () => pickAgent(a, AGENT_NAMES));
    const seqB = Array.from({ length: 20 }, () => pickAgent(b, AGENT_NAMES));
    expect(seqA).toEqual(seqB);
  });
});

describe("runMixto", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "stock-lab-mixto-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  type Fake = AgentModule & { calls: string[] };

  function fakeModule(name: AgentName, options: { failSetup?: boolean; failTeardown?: boolean } = {}): Fake {
    const calls: string[] = [];
    return {
      calls,
      async setup(ctx) {
        calls.push("setup");
        if (options.failSetup) throw new Error(`${name} sin login`);
        ctx.catalog = [];
      },
      async step(ctx) {
        calls.push("step");
        ctx.logger.log({ op: "noop", payload: { name }, status: 200, response_id: null, expected_delta: {} });
      },
      async teardown() {
        calls.push("teardown");
        if (options.failTeardown) throw new Error(`${name} teardown`);
      },
    };
  }

  function createContext(name: AgentName, index: number, args: { run: string; seed: number }): AgentContext {
    return {
      client: {} as AgentContext["client"],
      logger: new EventLogger(args.run, `mixto-${name}`, dir),
      rng: createRng(args.seed + index + 1),
      catalog: [],
      state: {},
    };
  }

  it("hace setup de los cuatro, reparte los steps, carga catálogo si quedó vacío y hace teardown en orden inverso", async () => {
    const fakes: Record<AgentName, Fake> = {
      vendedor: fakeModule("vendedor"),
      comprador: fakeModule("comprador"),
      almacen: fakeModule("almacen"),
      caos: fakeModule("caos"),
    };
    const order: string[] = [];
    for (const name of AGENT_NAMES) {
      const original = fakes[name].teardown;
      fakes[name].teardown = async (ctx) => {
        order.push(name);
        await original(ctx);
      };
    }
    const catalogLoads: string[] = [];
    const result = await runMixto(
      { run: "run-mixto", seed: 1, ops: 200, agent: "mixto" },
      {
        modules: Object.fromEntries(AGENT_NAMES.map((n) => [n, async () => fakes[n]])),
        createContext,
        loadCatalog: async (ctx) => {
          catalogLoads.push(ctx.logger.agent);
          return [];
        },
        log: () => undefined,
      },
    );

    expect(result.iterations).toBe(200);
    expect(result.active).toEqual([...AGENT_NAMES]);
    expect(result.setupFailures).toEqual({});
    expect(order).toEqual(["caos", "almacen", "comprador", "vendedor"]);
    expect(catalogLoads.sort()).toEqual(["mixto-almacen", "mixto-caos", "mixto-comprador", "mixto-vendedor"]);
    const steps = AGENT_NAMES.map((n) => fakes[n].calls.filter((c) => c === "step").length);
    expect(steps.reduce((a, b) => a + b, 0)).toBe(200);
    expect(steps.every((n) => n > 0)).toBe(true);
    const events = readEvents(join(dir, "run-mixto", "events.jsonl"));
    expect(events).toHaveLength(200);
    expect(new Set(events.map((e) => e.agent))).toEqual(new Set(AGENT_NAMES.map((n) => `mixto-${n}`)));
  });

  it("excluye al que falla en setup y sigue con el resto; anota fallos de teardown", async () => {
    const fakes: Record<AgentName, Fake> = {
      vendedor: fakeModule("vendedor"),
      comprador: fakeModule("comprador", { failSetup: true }),
      almacen: fakeModule("almacen", { failTeardown: true }),
      caos: fakeModule("caos"),
    };
    const logged: string[] = [];
    const result = await runMixto(
      { run: "run-mixto-2", seed: 3, ops: 50, agent: "mixto" },
      {
        modules: Object.fromEntries(AGENT_NAMES.map((n) => [n, async () => fakes[n]])),
        createContext,
        loadCatalog: async () => [],
        log: (line) => logged.push(line),
      },
    );
    expect(result.active).toEqual(["vendedor", "almacen", "caos"]);
    expect(result.setupFailures).toEqual({ comprador: "comprador sin login" });
    expect(result.teardownFailures).toEqual({ almacen: "almacen teardown" });
    expect(fakes.comprador.calls).toEqual(["setup"]);
    expect(logged.some((l) => l.includes("comprador excluido"))).toBe(true);
  });

  it("lanza si ningún agente pasa el setup", async () => {
    const fakes = Object.fromEntries(AGENT_NAMES.map((n) => [n, async () => fakeModule(n, { failSetup: true })]));
    await expect(
      runMixto({ run: "run-mixto-3", seed: 1, ops: 1, agent: "mixto" }, { modules: fakes, createContext, log: () => undefined }),
    ).rejects.toThrow(/ningún agente pasó el setup/);
  });

  it("un step que lanza se registra como agent_error y no detiene el bucle", async () => {
    const vendedor = fakeModule("vendedor");
    let n = 0;
    vendedor.step = async () => {
      n += 1;
      if (n === 2) throw new Error("boom");
    };
    const result = await runMixto(
      { run: "run-mixto-4", seed: 5, ops: 10, agent: "mixto" },
      {
        modules: { vendedor: async () => vendedor, comprador: async () => fakeModule("comprador", { failSetup: true }), almacen: async () => fakeModule("almacen", { failSetup: true }), caos: async () => fakeModule("caos", { failSetup: true }) },
        createContext,
        loadCatalog: async () => [],
        log: () => undefined,
      },
    );
    expect(result.iterations).toBe(10);
    const events = readEvents(join(dir, "run-mixto-4", "events.jsonl"));
    expect(events.filter((e) => e.op === "agent_error" && e.status === 0)).toHaveLength(1);
  });
});
