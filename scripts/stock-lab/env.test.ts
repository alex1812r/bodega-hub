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
  // Contenido del archivo lab, fijo aquí para no depender del `.env.stock-lab` local.
  // STK-510 (C21): la guarda compara también el puerto, así que las URLs de estos
  // tests usan los puertos del lab (antes 54321/54322, que ya no son del laboratorio).
  const LAB = {
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:14321",
    STOCK_LAB_DB_URL: "postgresql://postgres:postgres@127.0.0.1:14322/postgres",
    STOCK_TEST_ALLOW_WRITES_HOST: "127.0.0.1",
    PORT: "3100",
  };

  it("acepta 127.0.0.1 en una URL http", () => {
    expect(assertAllowedWriteHost("http://127.0.0.1:14321", "127.0.0.1", LAB)).toBe(
      "127.0.0.1",
    );
  });

  it("acepta 127.0.0.1 en una cadena de conexión postgresql", () => {
    expect(
      assertAllowedWriteHost(
        "postgresql://postgres:postgres@127.0.0.1:14322/postgres",
        "127.0.0.1",
        LAB,
      ),
    ).toBe("127.0.0.1");
  });

  it("lanza con un host de producción", () => {
    expect(() =>
      assertAllowedWriteHost("https://db.abc.supabase.co", "127.0.0.1", LAB),
    ).toThrow(/db\.abc\.supabase\.co/);
    expect(() =>
      assertAllowedWriteHost(
        "postgresql://postgres:x@db.abc.supabase.co:5432/postgres",
        "127.0.0.1",
        LAB,
      ),
    ).toThrow(/127\.0\.0\.1/);
  });

  it("lanza si allowedHost es undefined o vacío", () => {
    expect(() => assertAllowedWriteHost("http://127.0.0.1:14321", undefined, LAB)).toThrow(
      /STOCK_TEST_ALLOW_WRITES_HOST/,
    );
    expect(() => assertAllowedWriteHost("http://127.0.0.1:14321", "  ", LAB)).toThrow(
      /STOCK_TEST_ALLOW_WRITES_HOST/,
    );
  });

  it("lanza si la URL no es parseable", () => {
    expect(() => assertAllowedWriteHost("no-es-una-url", "127.0.0.1", LAB)).toThrow(
      /no se pudo extraer el host/,
    );
  });

  it("sin tercer argumento toma host y puertos del archivo lab versionado", () => {
    const file = loadStockLabEnv();
    expect(assertAllowedWriteHost(file.STOCK_LAB_DB_URL, file.STOCK_TEST_ALLOW_WRITES_HOST)).toBe("127.0.0.1");
    expect(assertAllowedWriteHost(file.NEXT_PUBLIC_SUPABASE_URL, file.STOCK_TEST_ALLOW_WRITES_HOST)).toBe("127.0.0.1");
  });

  it("acepta el BFF del laboratorio en el PORT del archivo", () => {
    expect(assertAllowedWriteHost("http://127.0.0.1:3100", "127.0.0.1", LAB)).toBe("127.0.0.1");
  });

  it("lanza si el archivo lab no define el host permitido, aunque el llamador traiga uno", () => {
    expect(() =>
      assertAllowedWriteHost(LAB.STOCK_LAB_DB_URL, "127.0.0.1", { ...LAB, STOCK_TEST_ALLOW_WRITES_HOST: "" }),
    ).toThrow(/STOCK_TEST_ALLOW_WRITES_HOST/);
  });

  it("lanza si el host permitido declarado no es el del archivo lab", () => {
    expect(() =>
      assertAllowedWriteHost("postgresql://u:p@db.example.invalid:14322/postgres", "db.example.invalid", LAB),
    ).toThrow(/no es el de \.env\.stock-lab/);
  });

  it("los puertos permitidos son los del archivo lab, por tipo de conexión", () => {
    const other = { ...LAB, STOCK_LAB_DB_URL: "postgresql://postgres:postgres@127.0.0.1:6543/postgres" };
    expect(assertAllowedWriteHost("postgresql://postgres:postgres@127.0.0.1:6543/postgres", "127.0.0.1", other)).toBe(
      "127.0.0.1",
    );
    expect(() =>
      assertAllowedWriteHost("postgresql://postgres:postgres@127.0.0.1:14322/postgres", "127.0.0.1", other),
    ).toThrow(/puerto 14322/);
    // El puerto de la API no vale para Postgres ni el de Postgres para http.
    expect(() =>
      assertAllowedWriteHost("postgresql://postgres:postgres@127.0.0.1:14321/postgres", "127.0.0.1", LAB),
    ).toThrow(/puerto 14321/);
    expect(() => assertAllowedWriteHost("http://127.0.0.1:14322", "127.0.0.1", LAB)).toThrow(/puerto 14322/);
  });

  it("una URL del archivo que no apunta al host permitido no aporta puerto", () => {
    const env = { ...LAB, STOCK_LAB_DB_URL: "postgresql://u:p@db.example.invalid:5432/postgres" };
    expect(() =>
      assertAllowedWriteHost("postgresql://postgres:postgres@127.0.0.1:5432/postgres", "127.0.0.1", env),
    ).toThrow(/ninguno definido/);
  });

  it("rechaza parámetros de conexión que cambian el destino y esquemas que no son http/postgres", () => {
    for (const param of ["host=db.example.invalid", "hostaddr=203.0.113.9", "port=5432", "service=prod"]) {
      expect(() => assertAllowedWriteHost(`${LAB.STOCK_LAB_DB_URL}?${param}`, "127.0.0.1", LAB)).toThrow(
        new RegExp(`parámetro "${param.split("=")[0]}"`),
      );
    }
    expect(() => assertAllowedWriteHost("socket://127.0.0.1:14322/var/run", "127.0.0.1", LAB)).toThrow(/esquema/);
    expect(assertAllowedWriteHost(`${LAB.STOCK_LAB_DB_URL}?sslmode=disable`, "127.0.0.1", LAB)).toBe("127.0.0.1");
    // En http los parámetros de consulta no cambian el destino.
    expect(assertAllowedWriteHost("http://127.0.0.1:14321/rest/v1/?host=x", "127.0.0.1", LAB)).toBe("127.0.0.1");
  });
});
