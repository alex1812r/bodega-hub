/** @jest-environment node */
/**
 * STK-413 · regresión de C21 (guardas de host del laboratorio saltables).
 *
 * Los `it.failing` describen el comportamiento SANO y hoy fallan: al corregir la
 * guarda (fase 5) hay que convertirlos en `it`. Solo hosts inventados
 * (`evil.example`, rango de documentación 203.0.113.0/24); nunca se conecta a nada.
 */
import { Client } from "pg";

import { assertAllowedWriteHost } from "./env";
import { STOCK_LAB_PORTS } from "./pipeline";
import { openLabSession } from "./scenarios/lib";

const LAB_HOST = "127.0.0.1";
const LAB_FILE_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: `http://${LAB_HOST}:14321`,
  STOCK_LAB_DB_URL: `postgresql://postgres:postgres@${LAB_HOST}:14322/postgres`,
  STOCK_TEST_ALLOW_WRITES_HOST: LAB_HOST,
};

jest.mock("pg", () => ({ Client: jest.fn() }));

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
  it.failing.each([
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
  it.failing.each([
    ["base en un puerto que no es del lab", `postgresql://postgres:postgres@${LAB_HOST}:1/postgres`],
    ["base en el puerto por defecto de Postgres", `postgresql://postgres:postgres@${LAB_HOST}:5432/postgres`],
    ["API en un puerto que no es del lab", `http://${LAB_HOST}:8000`],
  ])("rechaza el host permitido con otro puerto: %s", (_caso, url) => {
    expect(() => assertAllowedWriteHost(url, LAB_HOST)).toThrow();
  });

  describe("host permitido tomado del entorno", () => {
    const saved = {
      dbUrl: process.env.STOCK_LAB_DB_URL,
      host: process.env.STOCK_TEST_ALLOW_WRITES_HOST,
    };
    const clientMock = Client as unknown as jest.Mock;

    function restore(key: "STOCK_LAB_DB_URL" | "STOCK_TEST_ALLOW_WRITES_HOST", value: string | undefined) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
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
    it.failing(
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
  });
});
