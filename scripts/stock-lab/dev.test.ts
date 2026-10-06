/** @jest-environment node */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertBuildTargetsLab,
  inspectBundleText,
  parseLabServerArgs,
  REQUIRED_KEYS,
  resolveLabServerEnv,
  resolveLabServerSteps,
} from "./dev";

const LAB_URL = "http://127.0.0.1:14321";
const PROD_HOST = "abcdefghijklmnopqrst.supabase.co";

function labEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    NEXT_PUBLIC_SUPABASE_URL: LAB_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "lab-anon",
    SUPABASE_SERVICE_ROLE_KEY: "lab-service",
    API_DATA_SOURCE: "supabase",
    NEXT_PUBLIC_API_DATA_SOURCE: "supabase",
    ALLOW_DEMO_AUTH: "false",
    NEXT_PUBLIC_ALLOW_DEMO_AUTH: "false",
    PORT: "3100",
    STOCK_TEST_ALLOW_WRITES_HOST: "127.0.0.1",
    ...overrides,
  };
}

describe("parseLabServerArgs", () => {
  it("usa modo dev sin argumentos", () => {
    expect(parseLabServerArgs([])).toEqual({ mode: "dev", build: false });
  });

  it("--start compila por defecto", () => {
    expect(parseLabServerArgs(["--start"])).toEqual({ mode: "start", build: true });
    expect(parseLabServerArgs(["--mode", "start"])).toEqual({ mode: "start", build: true });
    expect(parseLabServerArgs(["--mode=start"])).toEqual({ mode: "start", build: true });
  });

  it("--no-build reutiliza el build, en cualquier orden", () => {
    expect(parseLabServerArgs(["--start", "--no-build"])).toEqual({ mode: "start", build: false });
    expect(parseLabServerArgs(["--no-build", "--start"])).toEqual({ mode: "start", build: false });
  });

  it("rechaza --no-build en modo dev, modos y argumentos desconocidos", () => {
    expect(() => parseLabServerArgs(["--no-build"])).toThrow(/--no-build solo/);
    expect(() => parseLabServerArgs(["--mode", "prod"])).toThrow(/--mode debe ser/);
    expect(() => parseLabServerArgs(["--mode"])).toThrow(/--mode debe ser/);
    expect(() => parseLabServerArgs(["--turbo"])).toThrow(/Argumento desconocido/);
  });
});

describe("resolveLabServerEnv", () => {
  it("las variables lab pisan las del entorno base (producción no se cuela)", () => {
    const result = resolveLabServerEnv(labEnv(), {
      NEXT_PUBLIC_SUPABASE_URL: `https://${PROD_HOST}`,
      SUPABASE_SERVICE_ROLE_KEY: "prod-service",
      PATH: "/usr/bin",
    });

    expect(result.supabaseUrl).toBe(LAB_URL);
    expect(result.port).toBe("3100");
    expect(result.env.NEXT_PUBLIC_SUPABASE_URL).toBe(LAB_URL);
    expect(result.env.SUPABASE_SERVICE_ROLE_KEY).toBe("lab-service");
    expect(result.env.PATH).toBe("/usr/bin");
    expect(result.env.PORT).toBe("3100");
  });

  it("usa el puerto 3100 si el archivo no define PORT, ignorando el del entorno", () => {
    const env = labEnv();
    delete env.PORT;
    const result = resolveLabServerEnv(env, { PORT: "3000" });
    expect(result.port).toBe("3100");
    expect(result.env.PORT).toBe("3100");
  });

  it.each(REQUIRED_KEYS)("falla si falta %s", (key) => {
    expect(() => resolveLabServerEnv(labEnv({ [key]: "" }))).toThrow(key);
  });

  it("falla si la URL de Supabase no es el host permitido", () => {
    expect(() =>
      resolveLabServerEnv(labEnv({ NEXT_PUBLIC_SUPABASE_URL: `https://${PROD_HOST}` })),
    ).toThrow(/no es el host permitido/);
  });

  it("falla si no hay host permitido declarado", () => {
    expect(() => resolveLabServerEnv(labEnv({ STOCK_TEST_ALLOW_WRITES_HOST: "" }))).toThrow(
      /STOCK_TEST_ALLOW_WRITES_HOST/,
    );
  });
});

describe("resolveLabServerSteps", () => {
  it("dev: next dev --webpack en el puerto lab", () => {
    expect(resolveLabServerSteps({ mode: "dev", build: false }, "3100")).toEqual([
      { name: "dev", args: ["next", "dev", "--webpack", "-p", "3100"] },
    ]);
  });

  it("start: build y luego start", () => {
    expect(resolveLabServerSteps({ mode: "start", build: true }, "3100")).toEqual([
      { name: "build", args: ["next", "build"] },
      { name: "start", args: ["next", "start", "-p", "3100"] },
    ]);
  });

  it("start --no-build: solo start", () => {
    expect(resolveLabServerSteps({ mode: "start", build: false }, "3200")).toEqual([
      { name: "start", args: ["next", "start", "-p", "3200"] },
    ]);
  });
});

describe("inspectBundleText", () => {
  it("detecta la URL lab", () => {
    expect(inspectBundleText(`createClient("${LAB_URL}","k")`, LAB_URL)).toEqual({
      hasLabUrl: true,
      foreignHosts: [],
    });
  });

  it("detecta hosts de Supabase Cloud, sin duplicados", () => {
    const text = `a="https://${PROD_HOST}";b="wss://${PROD_HOST.toUpperCase()}/realtime"`;
    expect(inspectBundleText(text, LAB_URL)).toEqual({
      hasLabUrl: false,
      foreignHosts: [PROD_HOST],
    });
  });

  it("no confunde documentación ni dominios genéricos con un proyecto", () => {
    const text = 'see https://supabase.com/docs or "*.supabase.co" or https://example.supabase.co';
    expect(inspectBundleText(text, LAB_URL).foreignHosts).toEqual([]);
  });
});

describe("assertBuildTargetsLab", () => {
  let dist: string;

  beforeEach(() => {
    dist = mkdtempSync(join(tmpdir(), "stk401-"));
    mkdirSync(join(dist, "static", "chunks"), { recursive: true });
    mkdirSync(join(dist, "server", "app"), { recursive: true });
  });

  afterEach(() => {
    rmSync(dist, { recursive: true, force: true });
  });

  it("falla si no existe el build", () => {
    expect(() => assertBuildTargetsLab(dist, LAB_URL)).toThrow(/No hay build/);
  });

  it("acepta un build que solo apunta al lab", () => {
    writeFileSync(join(dist, "BUILD_ID"), "x");
    writeFileSync(join(dist, "static", "chunks", "a.js"), `u="${LAB_URL}"`);
    writeFileSync(join(dist, "server", "app", "b.js"), "noop()");
    expect(assertBuildTargetsLab(dist, LAB_URL)).toBe(2);
  });

  it("rechaza un build con un host de producción en cualquier chunk", () => {
    writeFileSync(join(dist, "BUILD_ID"), "x");
    writeFileSync(join(dist, "static", "chunks", "a.js"), `u="${LAB_URL}"`);
    writeFileSync(join(dist, "server", "app", "b.js"), `u="https://${PROD_HOST}"`);
    expect(() => assertBuildTargetsLab(dist, LAB_URL)).toThrow(PROD_HOST);
  });

  it("rechaza un build que no contiene la URL lab", () => {
    writeFileSync(join(dist, "BUILD_ID"), "x");
    writeFileSync(join(dist, "static", "chunks", "a.js"), "noop()");
    expect(() => assertBuildTargetsLab(dist, LAB_URL)).toThrow(/no se compiló con el entorno lab/);
  });
});
