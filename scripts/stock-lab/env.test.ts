import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  STOCK_LAB_ENV_EXAMPLE,
  STOCK_LAB_ENV_FILE,
  assertAllowedWriteHost,
  loadStockLabEnv,
  parseEnvFile,
} from "./env";
import { STOCK_LAB_PORTS } from "./pipeline";

function stockLabPort(section: string, key: string): number {
  const entry = STOCK_LAB_PORTS.find(([s, k]) => s === section && k === key);
  if (!entry) throw new Error(`STOCK_LAB_PORTS no define ${section}.${key}`);
  return entry[2];
}

describe("parseEnvFile", () => {
  it("ignora comentarios y líneas vacías", () => {
    const parsed = parseEnvFile(
      "# comentario\n\n   \nFOO=bar\n# OTRO=no\nBAZ=qux\n",
    );
    expect(parsed).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("quita comillas simples y dobles envolventes", () => {
    const parsed = parseEnvFile(
      `A="con espacios"\nB='simple'\nC=sin\nD="mixta'\nE=a=b=c\n`,
    );
    expect(parsed).toEqual({
      A: "con espacios",
      B: "simple",
      C: "sin",
      D: `"mixta'`,
      E: "a=b=c",
    });
  });

  it("acepta saltos de línea CRLF y espacios alrededor del igual", () => {
    const parsed = parseEnvFile("A = 1\r\nB=2\r\n# c\r\nURL=http://127.0.0.1:54321\r\n");
    expect(parsed).toEqual({ A: "1", B: "2", URL: "http://127.0.0.1:54321" });
  });

  it("ignora líneas sin clave o sin igual", () => {
    expect(parseEnvFile("=valor\nSINIGUAL\nOK=1")).toEqual({ OK: "1" });
  });
});

describe("loadStockLabEnv", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "stock-lab-env-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("prefiere .env.stock-lab cuando existe", () => {
    writeFileSync(join(dir, STOCK_LAB_ENV_FILE), "PORT=3100\nX=real\n");
    writeFileSync(join(dir, STOCK_LAB_ENV_EXAMPLE), "PORT=1\nX=example\n");
    expect(loadStockLabEnv(dir)).toEqual({ PORT: "3100", X: "real" });
  });

  it("cae al .env.stock-lab.example si no hay .env.stock-lab", () => {
    writeFileSync(join(dir, STOCK_LAB_ENV_EXAMPLE), "PORT=3100\nX=example\n");
    expect(loadStockLabEnv(dir)).toEqual({ PORT: "3100", X: "example" });
  });

  it("lanza si no existe ninguno de los dos archivos", () => {
    expect(() => loadStockLabEnv(dir)).toThrow(STOCK_LAB_ENV_EXAMPLE);
  });

  it("sin rootDir usa la raíz del repo y carga el example versionado", () => {
    const env = loadStockLabEnv();
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe(`http://127.0.0.1:${stockLabPort("api", "port")}`);
    expect(env.STOCK_LAB_DB_URL).toContain(`127.0.0.1:${stockLabPort("db", "port")}`);
    expect(env.STOCK_TEST_ALLOW_WRITES_HOST).toBe("127.0.0.1");
    expect(env.API_DATA_SOURCE).toBe("supabase");
    expect(env.ALLOW_DEMO_AUTH).toBe("false");
    expect(env.PORT).toBe("3100");
  });
});

describe("assertAllowedWriteHost", () => {
  it("acepta 127.0.0.1 en una URL http", () => {
    expect(assertAllowedWriteHost("http://127.0.0.1:54321", "127.0.0.1")).toBe(
      "127.0.0.1",
    );
  });

  it("acepta 127.0.0.1 en una cadena de conexión postgresql", () => {
    expect(
      assertAllowedWriteHost(
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
        "127.0.0.1",
      ),
    ).toBe("127.0.0.1");
  });

  it("lanza con un host de producción", () => {
    expect(() =>
      assertAllowedWriteHost("https://db.abc.supabase.co", "127.0.0.1"),
    ).toThrow(/db\.abc\.supabase\.co/);
    expect(() =>
      assertAllowedWriteHost(
        "postgresql://postgres:x@db.abc.supabase.co:5432/postgres",
        "127.0.0.1",
      ),
    ).toThrow(/127\.0\.0\.1/);
  });

  it("lanza si allowedHost es undefined o vacío", () => {
    expect(() => assertAllowedWriteHost("http://127.0.0.1:54321", undefined)).toThrow(
      /STOCK_TEST_ALLOW_WRITES_HOST/,
    );
    expect(() => assertAllowedWriteHost("http://127.0.0.1:54321", "  ")).toThrow(
      /STOCK_TEST_ALLOW_WRITES_HOST/,
    );
  });

  it("lanza si la URL no es parseable", () => {
    expect(() => assertAllowedWriteHost("no-es-una-url", "127.0.0.1")).toThrow(
      /no se pudo extraer el host/,
    );
  });
});
