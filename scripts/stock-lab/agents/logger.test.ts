import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { EVENTS_FILE_NAME, EventLogger, defaultRunsRootDir, readEvents } from "./logger";

describe("EventLogger", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "stock-lab-logger-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("escribe en <rootDir>/<runId>/events.jsonl creando carpetas y rellena ts/agent", () => {
    const logger = new EventLogger("run-1", "vendedor", dir);
    expect(logger.filePath).toBe(resolve(dir, "run-1", EVENTS_FILE_NAME));
    expect(existsSync(logger.filePath)).toBe(false);

    const before = Date.now();
    const written = logger.log({
      op: "sale_create",
      payload: { items: [{ productId: "p1", quantity: 2 }] },
      status: 201,
      response_id: "sale-1",
      expected_delta: { p1: -2 },
    });

    expect(existsSync(logger.filePath)).toBe(true);
    expect(written).toEqual({
      ts: expect.any(String),
      agent: "vendedor",
      op: "sale_create",
      payload: { items: [{ productId: "p1", quantity: 2 }] },
      status: 201,
      response_id: "sale-1",
      expected_delta: { p1: -2 },
    });
    expect(written).not.toHaveProperty("error");
    const ts = Date.parse(written.ts);
    expect(ts).toBeGreaterThanOrEqual(before - 1);
    expect(ts).toBeLessThanOrEqual(Date.now() + 1);
    expect(new Date(ts).toISOString()).toBe(written.ts);

    const lines = readFileSync(logger.filePath, "utf8").split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe("");
    expect(JSON.parse(lines[0] ?? "")).toEqual(written);
  });

  it("hace append de varios eventos (incluso desde dos loggers del mismo run)", () => {
    const a = new EventLogger("run-2", "vendedor-1", dir);
    const b = new EventLogger("run-2", "comprador", dir);
    a.log({ op: "sale_create", payload: {}, status: 201, response_id: "s1", expected_delta: { p: -1 } });
    b.log({ op: "purchase_create", payload: {}, status: 201, response_id: "c1", expected_delta: { p: 5 } });

    expect(a.filePath).toBe(b.filePath);
    const events = readEvents(a.filePath);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.agent)).toEqual(["vendedor-1", "comprador"]);
    expect(events.map((e) => e.op)).toEqual(["sale_create", "purchase_create"]);
  });

  it("fuerza expected_delta vacío cuando el status no es 2xx", () => {
    const logger = new EventLogger("run-3", "caos", dir);
    const e400 = logger.log({
      op: "chaos_over_stock",
      payload: {},
      status: 400,
      response_id: null,
      expected_delta: { p1: -999 },
      error: "PT400 stock insuficiente",
    });
    const e500 = logger.log({
      op: "sale_create",
      payload: {},
      status: 500,
      response_id: null,
      expected_delta: { p1: -1 },
    });
    const e0 = logger.log({
      op: "agent_error",
      payload: {},
      status: 0,
      response_id: null,
      expected_delta: { p1: -1 },
      error: "boom",
    });
    const e200 = logger.log({
      op: "sale_cancel",
      payload: {},
      status: 200,
      response_id: "s1",
      expected_delta: { p1: 1 },
    });

    expect(e400.expected_delta).toEqual({});
    expect(e400.error).toBe("PT400 stock insuficiente");
    expect(e500.expected_delta).toEqual({});
    expect(e0.expected_delta).toEqual({});
    expect(e200.expected_delta).toEqual({ p1: 1 });

    const stored = readEvents(logger.filePath);
    expect(stored.map((e) => e.expected_delta)).toEqual([{}, {}, {}, { p1: 1 }]);
  });

  it("no comparte la referencia de expected_delta con el llamador", () => {
    const logger = new EventLogger("run-4", "almacen", dir);
    const delta = { p1: 3 };
    const written = logger.log({ op: "adjustment", payload: {}, status: 201, response_id: "a1", expected_delta: delta });
    delta.p1 = 99;
    expect(written.expected_delta).toEqual({ p1: 3 });
  });

  it("lanza si runId o agent están vacíos", () => {
    expect(() => new EventLogger("", "x", dir)).toThrow("runId");
    expect(() => new EventLogger("run", "  ", dir)).toThrow("agent");
  });

  it("por defecto apunta a scripts/stock-lab/runs de la raíz del repo", () => {
    const logger = new EventLogger("run-x", "y");
    expect(logger.rootDir).toBe(defaultRunsRootDir());
    expect(logger.rootDir.replace(/\\/g, "/")).toMatch(/\/scripts\/stock-lab\/runs$/);
    expect(logger.filePath).toBe(resolve(defaultRunsRootDir(), "run-x", EVENTS_FILE_NAME));
  });
});

describe("readEvents", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "stock-lab-read-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("parsea el JSONL ignorando líneas vacías y CRLF", () => {
    const file = join(dir, "events.jsonl");
    const one = { ts: "2026-10-05T00:00:00.000Z", agent: "a", op: "noop", payload: null, status: 200, response_id: null, expected_delta: {} };
    const two = { ...one, agent: "b", op: "sale_create", status: 201, response_id: "s", expected_delta: { p: -1 } };
    writeFileSync(file, `${JSON.stringify(one)}\r\n\r\n${JSON.stringify(two)}\n\n   \n`);
    expect(readEvents(file)).toEqual([one, two]);
  });

  it("devuelve [] si el archivo no existe", () => {
    expect(readEvents(join(dir, "nope.jsonl"))).toEqual([]);
  });
});
