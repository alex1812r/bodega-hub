/** @jest-environment node */
/**
 * STK-413 · regresión de C21 (guardas de host del laboratorio saltables).
 *
 * Nacieron como `it.failing` (STK-413) y pasaron a `it` con el arreglo de STK-510.
 * Solo hosts inventados (`evil.example`, rango de documentación 203.0.113.0/24);
 * nunca se conecta a nada: `pg` y `child_process` están simulados.
 */
import { Client } from "pg";
import { parse as parsePgConnectionString } from "pg-connection-string";

import { openLab } from "./chaos/cases";
import { resolveStockLabDbUrl } from "./db-test-utils";
import { assertAllowedWriteHost } from "./env";
import { STOCK_LAB_PORTS } from "./pipeline";
import { readLabData } from "./run";
import { Lab } from "./scenarios/db";
import { openLabSession } from "./scenarios/lib";

const LAB_HOST = "127.0.0.1";
const LAB_FILE_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: `http://${LAB_HOST}:14321`,
  STOCK_LAB_DB_URL: `postgresql://postgres:postgres@${LAB_HOST}:14322/postgres`,
  STOCK_TEST_ALLOW_WRITES_HOST: LAB_HOST,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-de-prueba",
  SUPABASE_SERVICE_ROLE_KEY: "service-de-prueba",
  PORT: "3100",
};

jest.mock("pg", () => ({ Client: jest.fn() }));

// db-up lanza `npx supabase …` y run lanza agentes: ningún test debe arrancar procesos.
jest.mock("node:child_process", () => ({
  ...jest.requireActual<typeof import("node:child_process")>("node:child_process"),
  spawn: jest.fn(() => {
    throw new Error("sin procesos en jest");
  }),
  spawnSync: jest.fn(() => ({ status: 0 })),
}));

// El archivo lab se fija aquí para no depender de que exista `.env.stock-lab`
// en el checkout; `assertAllowedWriteHost` es el real.
jest.mock("./env", () => ({
  ...jest.requireActual<typeof import("./env")>("./env"),
  loadStockLabEnv: jest.fn(() => ({ ...LAB_FILE_ENV })),
}));

function labPort(section: string, key: string): number {
  const entry = STOCK_LAB_PORTS.find(([s, k]) => s === section && k === key);
  if (!entry) throw new Error(`STOCK_LAB_PORTS no define ${section}.${key}`);
  return entry[2];
}

describe("C21 · guardas de host del laboratorio", () => {
  const dbPort = labPort("db", "port");
  const apiPort = labPort("api", "port");

  // Control: cualquier arreglo debe seguir aceptando las URLs legítimas del lab
  // (si no, un "arreglo" que lance siempre pondría en verde los casos de abajo).
  it("acepta la base y la API del laboratorio en sus puertos", () => {
    expect(assertAllowedWriteHost(LAB_FILE_ENV.STOCK_LAB_DB_URL, LAB_HOST)).toBe(LAB_HOST);
    expect(assertAllowedWriteHost(`postgresql://postgres:postgres@${LAB_HOST}:${dbPort}/postgres?sslmode=disable`, LAB_HOST)).toBe(LAB_HOST);
    expect(assertAllowedWriteHost(`http://${LAB_HOST}:${apiPort}`, LAB_HOST)).toBe(LAB_HOST);
  });

  // Causa F1: `extractHostname` usa `new URL().hostname` y `pg` (pg-connection-string)
  // deja que el parámetro de consulta `host`/`hostaddr` pise al host de la URL.
  // Evento: caos/fases-1-3.md v9 (`?host=db.example.invalid` → `timeout expired`).
  // Código: scripts/stock-lab/env.ts:60-75 y :97-103.
  it.each([
    ["?host= distinto del permitido", `postgresql://postgres:postgres@${LAB_HOST}:${dbPort}/postgres?host=evil.example`],
    ["?hostaddr= distinto del permitido", `postgresql://postgres:postgres@${LAB_HOST}:${dbPort}/postgres?hostaddr=203.0.113.9`],
    ["host= detrás de otro parámetro", `postgresql://postgres:postgres@${LAB_HOST}:${dbPort}/postgres?sslmode=disable&host=evil.example`],
  ])("rechaza una URL de Postgres con %s", (_caso, url) => {
    expect(() => assertAllowedWriteHost(url, LAB_HOST)).toThrow();
  });

  // Causa F3: la guarda compara solo el hostname; un túnel local a otra base
  // (mismo 127.0.0.1, otro puerto) pasa.
  // Evento: caos/fases-1-3.md v8 (`127.0.0.1:1` → `connect ECONNREFUSED 127.0.0.1:1`).
  // Código: scripts/stock-lab/env.ts:97-103 (no mira `port`); puertos en pipeline.ts:71-76.
  it.each([
    ["base en un puerto que no es del lab", `postgresql://postgres:postgres@${LAB_HOST}:1/postgres`],
    ["base en el puerto por defecto de Postgres", `postgresql://postgres:postgres@${LAB_HOST}:5432/postgres`],
    ["API en un puerto que no es del lab", `http://${LAB_HOST}:8000`],
  ])("rechaza el host permitido con otro puerto: %s", (_caso, url) => {
    expect(() => assertAllowedWriteHost(url, LAB_HOST)).toThrow();
  });

  // Hueco de causes.md («C21 no tiene caso `?port=`») + el resto de parámetros y
  // formas con las que `pg-connection-string` cambia el destino sin tocar el host
  // visible de la URL (copia TODOS los parámetros de consulta a la config de `pg`).
  it.each([
    ["?port= distinto del lab", `postgresql://postgres:postgres@${LAB_HOST}:${dbPort}/postgres?port=5432`],
    ["port= detrás de otro parámetro", `postgresql://postgres:postgres@${LAB_HOST}:${dbPort}/postgres?sslmode=disable&port=1`],
    ["?port= igual al del lab (el destino va en la URL, no en parámetros)", `postgresql://postgres:postgres@${LAB_HOST}/postgres?port=${dbPort}`],
    ["?service=", `postgresql://postgres:postgres@${LAB_HOST}:${dbPort}/postgres?service=produccion`],
    ["un parámetro que no está en la lista permitida", `postgresql://postgres:postgres@${LAB_HOST}:${dbPort}/postgres?user=otro`],
    ["sin puerto (5432 por defecto)", `postgresql://postgres:postgres@${LAB_HOST}/postgres`],
    ["esquema socket:", "socket:/var/run/postgresql?db=postgres"],
    ["ruta de socket Unix", "/var/run/postgresql postgres"],
    ["socket Unix codificado como host", "postgresql://postgres:postgres@%2Fvar%2Frun%2Fpostgresql/postgres"],
    ["URL relativa al esquema", `//evil.example:${dbPort}/postgres`],
  ])("rechaza una conexión de Postgres con %s", (_caso, url) => {
    expect(() => assertAllowedWriteHost(url, LAB_HOST)).toThrow();
  });

  // Causa raíz de F1: la guarda y `pg` no leían la URL igual. Todo lo que la guarda
  // acepte tiene que resolver, con el parser real de `pg`, al host y puerto del lab.
  it("lo que acepta la guarda resuelve en el parser de pg al host y puerto del lab", () => {
    const base = `postgresql://postgres:postgres@${LAB_HOST}:${dbPort}/postgres`;
    const candidates = [
      base,
      `${base}?sslmode=disable`,
      `${base}?application_name=stock-lab&connect_timeout=5`,
      `postgres://postgres:postgres@${LAB_HOST}:${dbPort}/postgres`,
      `${base}?host=evil.example`,
      `${base}?hostaddr=203.0.113.9`,
      `${base}?port=5432`,
      `${base}?HOST=evil.example`,
      `${base}?sslmode=disable&host=evil.example&port=5432`,
      `postgresql://${LAB_HOST}:${dbPort}@evil.example:${dbPort}/postgres`,
      `${base}#?host=evil.example`,
      `postgresql://postgres:postgres@${LAB_HOST}.evil.example:${dbPort}/postgres`,
      `  ${base}?host=evil.example  `,
    ];
    const accepted = candidates.filter((url) => {
      try {
        assertAllowedWriteHost(url, LAB_HOST);
        return true;
      } catch {
        return false;
      }
    });
    expect(accepted.length).toBeGreaterThanOrEqual(4);
    for (const url of accepted) {
      const config = parsePgConnectionString(url);
      expect({ url, host: config.host, port: String(config.port) }).toEqual({ url, host: LAB_HOST, port: String(dbPort) });
    }
  });

  // Causa F2 sin ayuda del puerto: el host «permitido» que llega por argumento solo
  // vale si es el del archivo lab, aunque la URL use el puerto del lab.
  it("rechaza un host permitido que no es el del archivo lab", () => {
    expect(() =>
      assertAllowedWriteHost(`postgresql://postgres:postgres@evil.example:${dbPort}/postgres`, "evil.example"),
    ).toThrow(/evil\.example/);
    expect(() => assertAllowedWriteHost(`http://evil.example:${apiPort}`, "evil.example")).toThrow(/evil\.example/);
  });

  describe("host permitido tomado del entorno", () => {
    const HOSTILE_KEYS = [
      "STOCK_LAB_DB_URL",
      "STOCK_TEST_ALLOW_WRITES_HOST",
      "NEXT_PUBLIC_SUPABASE_URL",
      "STOCK_LAB_API_URL",
    ] as const;
    type HostileKey = (typeof HOSTILE_KEYS)[number];
    const saved = {
      dbUrl: process.env.STOCK_LAB_DB_URL,
      host: process.env.STOCK_TEST_ALLOW_WRITES_HOST,
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      apiUrl: process.env.STOCK_LAB_API_URL,
      argv: process.argv,
    };
    const clientMock = Client as unknown as jest.Mock;

    function restore(key: HostileKey, value: string | undefined) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }

    /**
     * Entorno heredado hostil: URL de base, URL de Supabase y host permitido apuntan
     * los tres a `evil.example`, CON los puertos del lab (así no lo frena el puerto).
     */
    function setHostileEnv() {
      process.env.STOCK_LAB_DB_URL = `postgresql://postgres:postgres@evil.example:${dbPort}/postgres`;
      process.env.NEXT_PUBLIC_SUPABASE_URL = `http://evil.example:${apiPort}`;
      process.env.STOCK_TEST_ALLOW_WRITES_HOST = "evil.example";
    }

    function clearHostileEnv() {
      for (const key of HOSTILE_KEYS) delete process.env[key];
    }

    async function waitFor(done: () => boolean): Promise<void> {
      for (let i = 0; i < 200 && !done(); i += 1) await new Promise((r) => setTimeout(r, 10));
      if (!done()) throw new Error("el punto de entrada no terminó");
    }

    beforeEach(() => {
      clientMock.mockReset();
      // Ningún test llega a una base: el intento de conexión se registra y se corta.
      clientMock.mockImplementation(() => ({
        connect: jest.fn().mockRejectedValue(new Error("sin base en jest")),
        end: jest.fn().mockResolvedValue(undefined),
        query: jest.fn().mockRejectedValue(new Error("sin base en jest")),
      }));
    });

    afterEach(() => {
      restore("STOCK_LAB_DB_URL", saved.dbUrl);
      restore("STOCK_TEST_ALLOW_WRITES_HOST", saved.host);
      restore("NEXT_PUBLIC_SUPABASE_URL", saved.supabaseUrl);
      restore("STOCK_LAB_API_URL", saved.apiUrl);
      process.argv = saved.argv;
      process.exitCode = undefined;
      jest.restoreAllMocks();
    });

    function attemptedConnectionStrings(): string[] {
      return clientMock.mock.calls.map((call: unknown[]) => {
        const config = call[0] as { connectionString?: string } | undefined;
        return config?.connectionString ?? "";
      });
    }

    // Causa F2: `process.env.STOCK_TEST_ALLOW_WRITES_HOST ?? file…`: quien fija el
    // entorno fija a la vez la URL y el host permitido, y la guarda no frena nada.
    // Evento: caos/fases-1-3.md v3/v6 (reconcile y db-up intentaron conectar).
    // Código: scripts/stock-lab/scenarios/lib.ts:810-813 (mismo patrón en db-up.ts:47-51,
    // reconcile.ts:81-85, run.ts:272-274, chaos/cases.ts:865, scenarios/db.ts:591).
    it(
      "no abre conexión a un host que el entorno declara permitido cuando el archivo lab permite otro",
      async () => {
        process.env.STOCK_LAB_DB_URL = "postgresql://postgres:postgres@evil.example:5432/postgres";
        process.env.STOCK_TEST_ALLOW_WRITES_HOST = "evil.example";

        await openLabSession("stk-413", []).catch(() => undefined);

        expect(attemptedConnectionStrings().filter((url) => url.includes("evil.example"))).toEqual([]);
      },
    );

    // Control del anterior: sin entorno hostil la sesión sí intenta la base del lab.
    it("con el entorno limpio intenta conectar solo a la base del archivo lab", async () => {
      delete process.env.STOCK_LAB_DB_URL;
      delete process.env.STOCK_TEST_ALLOW_WRITES_HOST;

      await openLabSession("stk-413", []).catch(() => undefined);

      expect(attemptedConnectionStrings()).toEqual([LAB_FILE_ENV.STOCK_LAB_DB_URL]);
    });

    // Hueco de causes.md: el mismo override en el resto de puntos de entrada
    // (caos/fases-1-3.md v3/v6: reconcile y db-up llegaron a `timeout expired`).
    const entryPoints: Array<[string, () => Promise<unknown>]> = [
      ["run.ts (readLabData)", () => readLabData()],
      ["chaos/cases.ts (openLab)", () => openLab("stk-510")],
      ["scenarios/db.ts (Lab.open)", () => Lab.open("stk-510")],
      ["db-test-utils.ts (resolveStockLabDbUrl)", async () => resolveStockLabDbUrl()],
    ];

    it.each(entryPoints)("%s aborta sin conectar con el entorno hostil", async (_nombre, open) => {
      setHostileEnv();

      await expect(open()).rejects.toThrow(/regla 1\.4/);

      expect(attemptedConnectionStrings()).toEqual([]);
    });

    it.each(entryPoints.slice(0, 3))("%s con el entorno limpio intenta solo la base del archivo lab", async (_nombre, open) => {
      clearHostileEnv();

      await open().catch(() => undefined);

      expect(attemptedConnectionStrings()).toEqual([LAB_FILE_ENV.STOCK_LAB_DB_URL]);
    });

    // STK-616 (M1): la puerta BFF devolvía en cuanto el host era loopback, sin mirar el
    // puerto, y la URL salía de `process.env`: un `next dev` normal en :3000 pasaba.
    it.each([
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://localhost:3100@evil.example",
      "http://evil.example:3100",
      "https://localhost:3100",
    ])("scenarios/db.ts (Lab.open) aborta sin conectar con STOCK_LAB_API_URL=%s", async (apiUrl) => {
      clearHostileEnv();
      process.env.STOCK_LAB_API_URL = apiUrl;

      await expect(Lab.open("stk-616")).rejects.toThrow(/regla 1.4/);

      expect(attemptedConnectionStrings()).toEqual([]);
    });

    // STK-616 (B3): el host permitido de estos dos puntos sale del archivo lab; uno
    // heredado del entorno no interviene ni para abortar.
    it.each(entryPoints.slice(1, 2).concat([["scenarios/lib.ts (openLabSession)", () => openLabSession("stk-616", [])]]))(
      "%s ignora el host permitido del entorno y usa el del archivo lab",
      async (_nombre, open) => {
        clearHostileEnv();
        process.env.STOCK_TEST_ALLOW_WRITES_HOST = "evil.example";

        await open().catch(() => undefined);

        expect(attemptedConnectionStrings()).toEqual([LAB_FILE_ENV.STOCK_LAB_DB_URL]);
      },
    );

    it("db-test-utils.ts devuelve la URL del archivo lab con el entorno limpio", () => {
      clearHostileEnv();
      expect(resolveStockLabDbUrl()).toBe(LAB_FILE_ENV.STOCK_LAB_DB_URL);
    });

    // reconcile.ts y db-up.ts ejecutan `main()` al importarse: se cargan una sola vez,
    // con el entorno hostil ya puesto y `pg` / `child_process` simulados.
    it("reconcile.ts (target local) aborta sin conectar con el entorno hostil", async () => {
      setHostileEnv();
      process.argv = ["node", "reconcile.ts"];
      const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
      jest.spyOn(console, "log").mockImplementation(() => undefined);

      await import("./reconcile");
      await waitFor(() => process.exitCode !== undefined);

      expect(attemptedConnectionStrings()).toEqual([]);
      expect(process.exitCode).toBe(1);
      expect(String(errors.mock.calls[0]?.[0])).toMatch(/regla 1\.4/);
    });

    it("db-up.ts aborta sin conectar ni arrancar supabase con el entorno hostil", async () => {
      setHostileEnv();
      process.argv = ["node", "db-up.ts", "up"];
      const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
      jest.spyOn(console, "log").mockImplementation(() => undefined);
      const exit = jest.spyOn(process, "exit").mockImplementation((() => undefined) as never);
      const { spawnSync } = jest.requireMock<typeof import("node:child_process")>("node:child_process");

      await import("./db-up");
      await waitFor(() => exit.mock.calls.length > 0);

      expect(attemptedConnectionStrings()).toEqual([]);
      expect(spawnSync).not.toHaveBeenCalled();
      expect(exit).toHaveBeenCalledWith(1);
      expect(String(errors.mock.calls[0]?.[0])).toMatch(/regla 1\.4/);
    });
  });
});
