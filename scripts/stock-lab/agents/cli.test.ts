import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  LAB_PASSWORD,
  LAB_USERS,
  assertLabApiHost,
  idempotencyKey,
  isLoopbackEquivalent,
  mapLabProduct,
  mapLabRegister,
  mapPackConversions,
  runLoop,
} from "./base";
import { parseAgentArgs } from "./cli";
import { EventLogger, readEvents } from "./logger";
import { createRng } from "./rng";

describe("parseAgentArgs", () => {
  it("parsea run/seed/minutes/agent", () => {
    expect(parseAgentArgs(["--run", "r1", "--seed", "42", "--minutes", "10", "--agent", "vendedor-2"])).toEqual({
      run: "r1",
      seed: 42,
      minutes: 10,
      agent: "vendedor-2",
    });
  });

  it("parsea --ops y acepta la forma --flag=valor", () => {
    expect(parseAgentArgs(["--run=r2", "--seed=7", "--ops=200"])).toEqual({
      run: "r2",
      seed: 7,
      ops: 200,
      agent: "agent",
    });
  });

  it("acepta minutes y ops a la vez", () => {
    expect(parseAgentArgs(["--run", "r", "--seed", "1", "--minutes", "0.5", "--ops", "3"])).toEqual({
      run: "r",
      seed: 1,
      minutes: 0.5,
      ops: 3,
      agent: "agent",
    });
  });

  it("usa defaultAgent cuando no viene --agent", () => {
    expect(parseAgentArgs(["--run", "r", "--seed", "1", "--ops", "1"], { defaultAgent: "comprador" }).agent).toBe(
      "comprador",
    );
    expect(
      parseAgentArgs(["--run", "r", "--seed", "1", "--ops", "1", "--agent", "caos"], { defaultAgent: "comprador" })
        .agent,
    ).toBe("caos");
  });

  it("acepta semillas negativas o cero", () => {
    expect(parseAgentArgs(["--run", "r", "--seed", "0", "--ops", "1"]).seed).toBe(0);
    expect(parseAgentArgs(["--run", "r", "--seed", "-5", "--ops", "1"]).seed).toBe(-5);
  });

  it("lanza si falta --run", () => {
    expect(() => parseAgentArgs(["--seed", "1", "--ops", "1"])).toThrow("Falta --run");
  });

  it("lanza si falta --seed o no es entero", () => {
    expect(() => parseAgentArgs(["--run", "r", "--ops", "1"])).toThrow("Falta --seed");
    expect(() => parseAgentArgs(["--run", "r", "--seed", "abc", "--ops", "1"])).toThrow("--seed debe ser un entero");
    expect(() => parseAgentArgs(["--run", "r", "--seed", "1.5", "--ops", "1"])).toThrow("--seed debe ser un entero");
  });

  it("lanza si no hay ni --minutes ni --ops", () => {
    expect(() => parseAgentArgs(["--run", "r", "--seed", "1"])).toThrow("--minutes <m> o --ops <n>");
  });

  it("lanza con minutes/ops no positivos u ops no entero", () => {
    expect(() => parseAgentArgs(["--run", "r", "--seed", "1", "--minutes", "0"])).toThrow("--minutes");
    expect(() => parseAgentArgs(["--run", "r", "--seed", "1", "--ops", "-3"])).toThrow("--ops");
    expect(() => parseAgentArgs(["--run", "r", "--seed", "1", "--ops", "2.5"])).toThrow("--ops");
  });

  it("lanza con flags desconocidas, sin valor, repetidas o posicionales", () => {
    expect(() => parseAgentArgs(["--run", "r", "--seed", "1", "--ops", "1", "--foo", "x"])).toThrow("--foo");
    expect(() => parseAgentArgs(["--run", "--seed", "1", "--ops", "1"])).toThrow("--run requiere un valor");
    expect(() => parseAgentArgs(["--run", "a", "--run", "b", "--seed", "1", "--ops", "1"])).toThrow("repetida");
    expect(() => parseAgentArgs(["r", "--seed", "1", "--ops", "1"])).toThrow("inesperado");
  });
});

describe("base.ts: constantes", () => {
  it("expone la clave y los cinco usuarios lab con su rol", () => {
    expect(LAB_PASSWORD).toBe("Lab2026!");
    expect(LAB_USERS).toEqual({
      admin: { email: "lab-admin@lab.local", role: "admin" },
      vendedor1: { email: "lab-vendedor-1@lab.local", role: "vendedor" },
      vendedor2: { email: "lab-vendedor-2@lab.local", role: "vendedor" },
      almacen: { email: "lab-almacen@lab.local", role: "almacen" },
      contador: { email: "lab-contador@lab.local", role: "contador" },
    });
  });
});

describe("base.ts: isLoopbackEquivalent / assertLabApiHost", () => {
  it("trata localhost, 127.0.0.1 y ::1 como el mismo host", () => {
    expect(isLoopbackEquivalent("localhost", "127.0.0.1")).toBe(true);
    expect(isLoopbackEquivalent("127.0.0.1", "LOCALHOST")).toBe(true);
    expect(isLoopbackEquivalent("::1", "localhost")).toBe(true);
    expect(isLoopbackEquivalent("example.com", "EXAMPLE.com")).toBe(true);
  });

  it("rechaza hosts distintos, vacíos o sin permitido", () => {
    expect(isLoopbackEquivalent("localhost", "db.supabase.co")).toBe(false);
    expect(isLoopbackEquivalent("localhost", undefined)).toBe(false);
    expect(isLoopbackEquivalent("", "localhost")).toBe(false);
    expect(isLoopbackEquivalent("localhost", "  ")).toBe(false);
  });

  it("assertLabApiHost acepta http://localhost:3100 con permitido 127.0.0.1", () => {
    expect(assertLabApiHost("http://localhost:3100", "127.0.0.1")).toBe("localhost");
    expect(assertLabApiHost("http://127.0.0.1:3100", "127.0.0.1")).toBe("127.0.0.1");
  });

  it("assertLabApiHost lanza contra hosts remotos o sin host permitido", () => {
    expect(() => assertLabApiHost("https://abc.supabase.co", "127.0.0.1")).toThrow("no es el host permitido");
    expect(() => assertLabApiHost("http://localhost:3100", undefined)).toThrow("STOCK_TEST_ALLOW_WRITES_HOST");
    expect(() => assertLabApiHost("no-es-url", "127.0.0.1")).toThrow("no se pudo extraer el host");
  });
});

describe("base.ts: mapeo de catálogo y cajas", () => {
  it("mapLabProduct marca isHot por SKU y rellena empaque desde el mapa", () => {
    const packs = mapPackConversions([
      { id: "c1", unitsPerPack: 12, packProduct: { id: "pack-1" }, linkedProduct: { id: "unit-1" } },
      { id: "c2", unitsPerPack: "6", packProduct: { id: "pack-2" }, unitProduct: { id: "unit-2" } },
      { id: "c3", unitsPerPack: 0, packProduct: { id: "pack-3" }, linkedProduct: { id: "unit-3" } },
      { id: "c4", unitsPerPack: 4, packProductId: "pack-4", unitProductId: "unit-4" },
      null,
      "basura",
    ]);
    expect([...packs.entries()]).toEqual([
      ["pack-1", { unitsPerPack: 12, unitProductId: "unit-1" }],
      ["pack-2", { unitsPerPack: 6, unitProductId: "unit-2" }],
      ["pack-4", { unitsPerPack: 4, unitProductId: "unit-4" }],
    ]);

    expect(
      mapLabProduct(
        { id: "pack-1", sku: "LAB-PACK-01", name: "Pack", isActive: true, currentStock: 10, salePriceRef: 12.5 },
        packs,
      ),
    ).toEqual({
      id: "pack-1",
      sku: "LAB-PACK-01",
      name: "Pack",
      isActive: true,
      currentStock: 10,
      salePrice: 12.5,
      isHot: false,
      packUnitsPerPack: 12,
      packUnitProductId: "unit-1",
    });

    expect(
      mapLabProduct({ id: "h1", sku: "LAB-HOT-03", name: "Hot", isActive: false, currentStock: "500", salePriceRef: 1 }),
    ).toEqual({
      id: "h1",
      sku: "LAB-HOT-03",
      name: "Hot",
      isActive: false,
      currentStock: 500,
      salePrice: 1,
      isHot: true,
      packUnitsPerPack: null,
      packUnitProductId: null,
    });
  });

  it("mapLabProduct devuelve null sin id/sku y tolera campos ausentes", () => {
    expect(mapLabProduct(null)).toBeNull();
    expect(mapLabProduct({ sku: "X" })).toBeNull();
    expect(mapLabProduct({ id: "1" })).toBeNull();
    expect(mapLabProduct({ id: "1", sku: "LAB-001" })).toEqual({
      id: "1",
      sku: "LAB-001",
      name: "",
      isActive: true,
      currentStock: 0,
      salePrice: 0,
      isHot: false,
      packUnitsPerPack: null,
      packUnitProductId: null,
    });
  });

  it("mapLabRegister mapea id/name/assignedUserId", () => {
    expect(mapLabRegister({ id: "r1", name: "Caja Lab 1", assignedUserId: "u1", isActive: true })).toEqual({
      id: "r1",
      name: "Caja Lab 1",
      assignedUserId: "u1",
    });
    expect(mapLabRegister({ id: "r2", name: "Caja Lab 2", assignedUserId: null })).toEqual({
      id: "r2",
      name: "Caja Lab 2",
      assignedUserId: null,
    });
    expect(mapLabRegister({ name: "sin id" })).toBeNull();
  });
});

describe("base.ts: idempotencyKey", () => {
  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it("devuelve un uuid v4 válido y determinista por semilla", () => {
    const a = createRng(42);
    const b = createRng(42);
    const keysA = Array.from({ length: 5 }, () => idempotencyKey(a));
    const keysB = Array.from({ length: 5 }, () => idempotencyKey(b));
    expect(keysA).toEqual(keysB);
    for (const key of keysA) {
      expect(key).toMatch(UUID_V4);
    }
    expect(new Set(keysA).size).toBe(5);
  });

  it("consume exactamente 4 valores del rng", () => {
    const probe = createRng(9);
    idempotencyKey(probe);
    const reference = createRng(9);
    for (let i = 0; i < 4; i += 1) reference.next();
    expect(probe.next()).toBe(reference.next());
  });

  it("semillas distintas dan claves distintas", () => {
    expect(idempotencyKey(createRng(1))).not.toBe(idempotencyKey(createRng(2)));
  });
});

describe("base.ts: runLoop", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "stock-lab-runloop-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("ejecuta exactamente ops iteraciones con índices 0..n-1", async () => {
    const seen: number[] = [];
    const total = await runLoop({ run: "r", seed: 1, ops: 4, agent: "a" }, async (i) => {
      seen.push(i);
    });
    expect(total).toBe(4);
    expect(seen).toEqual([0, 1, 2, 3]);
  });

  it("por minutos se detiene al vencer el reloj inyectado", async () => {
    let clock = 0;
    const total = await runLoop(
      { run: "r", seed: 1, minutes: 1, agent: "a" },
      async () => {
        clock += 20_000; // cada step "tarda" 20 s
      },
      { now: () => clock },
    );
    expect(total).toBe(3);
  });

  it("con ops y minutes a la vez gana el primero que se cumpla", async () => {
    let clock = 0;
    const total = await runLoop(
      { run: "r", seed: 1, minutes: 1, ops: 100, agent: "a" },
      async () => {
        clock += 30_000;
      },
      { now: () => clock },
    );
    expect(total).toBe(2);
  });

  it("captura errores de step, los loguea como agent_error status 0 y sigue", async () => {
    const logger = new EventLogger("run-loop", "almacen", dir);
    const total = await runLoop(
      { run: "run-loop", seed: 1, ops: 3, agent: "almacen" },
      async (i) => {
        if (i === 1) throw new Error("boom");
        if (i === 2) throw "texto";
      },
      { logger, errorDelayMs: 0 },
    );
    expect(total).toBe(3);
    const events = readEvents(logger.filePath);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      agent: "almacen",
      op: "agent_error",
      status: 0,
      response_id: null,
      expected_delta: {},
      error: "boom",
      payload: { iteration: 1 },
    });
    expect(events[1]).toMatchObject({ op: "agent_error", status: 0, error: "texto", payload: { iteration: 2 } });
  });

  it("sin logger escribe el error en stderr y no muere", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const total = await runLoop(
        { run: "r", seed: 1, ops: 2, agent: "a" },
        async () => {
          throw new Error("sin logger");
        },
        { errorDelayMs: 0 },
      );
      expect(total).toBe(2);
      expect(spy).toHaveBeenCalledTimes(2);
      expect(String(spy.mock.calls[0]?.[0])).toContain("sin logger");
    } finally {
      spy.mockRestore();
    }
  });

  it("lanza si no hay ops ni minutes", async () => {
    await expect(runLoop({ run: "r", seed: 1, agent: "a" }, async () => undefined)).rejects.toThrow(
      "ops o minutes",
    );
  });
});
