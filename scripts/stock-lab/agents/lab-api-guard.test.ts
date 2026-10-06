/** @jest-environment node */
/**
 * STK-616 · M1 del auditor final: la puerta BFF de la guarda de host aceptaba
 * cualquier puerto de loopback y tomaba la URL de `process.env`. Con un
 * `next dev` normal en :3000 (entorno de producción) los agentes pasaban la guarda.
 *
 * Sin red: solo se valida la URL; ningún test hace una petición.
 */
import { assertLabApiHost, createLabClient, labApiUrl } from "./base";

const LAB_FILE_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:14321",
  STOCK_LAB_DB_URL: "postgresql://postgres:postgres@127.0.0.1:14322/postgres",
  STOCK_TEST_ALLOW_WRITES_HOST: "127.0.0.1",
  PORT: "3100",
};

jest.mock("../env", () => ({
  ...jest.requireActual<typeof import("../env")>("../env"),
  loadStockLabEnv: jest.fn(() => ({ ...LAB_FILE_ENV })),
}));

const HOSTILE_URLS: Array<[string, string]> = [
  ["loopback en el puerto de `next dev` (localhost)", "http://localhost:3000"],
  ["loopback en el puerto de `next dev` (127.0.0.1)", "http://127.0.0.1:3000"],
  ["loopback sin puerto", "http://localhost"],
  ["el puerto de PostgREST del lab, que no es el BFF", "http://127.0.0.1:14321"],
  ["userinfo que parece host:puerto", "http://localhost:3100@evil.example"],
  ["userinfo delante del loopback", "http://evil.example@localhost:3100"],
  ["host remoto en el puerto del lab", "http://evil.example:3100"],
  ["https en loopback", "https://localhost:3100"],
  ["https remoto", "https://abcdefghijklmnopqrst.supabase.co"],
  ["otro esquema", "ftp://localhost:3100"],
  ["URL malformada", "no-es-url"],
  ["URL vacía", "   "],
];

describe("M1 · guarda de la URL del BFF del laboratorio", () => {
  const savedApiUrl = process.env.STOCK_LAB_API_URL;

  afterEach(() => {
    if (savedApiUrl === undefined) delete process.env.STOCK_LAB_API_URL;
    else process.env.STOCK_LAB_API_URL = savedApiUrl;
  });

  it.each(HOSTILE_URLS)("assertLabApiHost aborta con %s", (_caso, url) => {
    expect(() => assertLabApiHost(url, "127.0.0.1", LAB_FILE_ENV)).toThrow(/regla 1\.4/);
  });

  it("assertLabApiHost acepta el BFF del lab por cualquiera de los dos alias de loopback", () => {
    expect(assertLabApiHost("http://localhost:3100", "127.0.0.1", LAB_FILE_ENV)).toBe("localhost");
    expect(assertLabApiHost("http://127.0.0.1:3100", "127.0.0.1", LAB_FILE_ENV)).toBe("127.0.0.1");
  });

  it("el puerto exigido es el PORT del archivo lab (3100 si no lo declara)", () => {
    const otherPort = { ...LAB_FILE_ENV, PORT: "3200" };
    expect(assertLabApiHost("http://localhost:3200", "127.0.0.1", otherPort)).toBe("localhost");
    expect(() => assertLabApiHost("http://localhost:3100", "127.0.0.1", otherPort)).toThrow(/regla 1\.4/);

    const withoutPort = { ...LAB_FILE_ENV, PORT: undefined };
    expect(assertLabApiHost("http://localhost:3100", "127.0.0.1", withoutPort)).toBe("localhost");
    expect(() => assertLabApiHost("http://localhost:3000", "127.0.0.1", withoutPort)).toThrow(/regla 1\.4/);
  });

  it("labApiUrl sale del archivo lab y cae a http://localhost:<PORT> si no declara STOCK_LAB_API_URL", () => {
    const withoutPort = { ...LAB_FILE_ENV, PORT: undefined };
    expect(labApiUrl(LAB_FILE_ENV, {})).toBe("http://localhost:3100");
    expect(labApiUrl(withoutPort, {})).toBe("http://localhost:3100");
    expect(labApiUrl({ ...LAB_FILE_ENV, PORT: "3200" }, {})).toBe("http://localhost:3200");
    expect(labApiUrl({ ...LAB_FILE_ENV, STOCK_LAB_API_URL: "http://127.0.0.1:3100/" }, {})).toBe("http://127.0.0.1:3100");
  });

  it.each(HOSTILE_URLS.filter(([, url]) => url.trim() !== ""))(
    "labApiUrl aborta si process.env.STOCK_LAB_API_URL trae %s",
    (_caso, url) => {
      expect(() => labApiUrl(LAB_FILE_ENV, { STOCK_LAB_API_URL: url })).toThrow(/regla 1\.4/);
    },
  );

  it("labApiUrl aborta si el entorno heredado trae otra URL que la del archivo lab, aunque sea loopback", () => {
    expect(() => labApiUrl(LAB_FILE_ENV, { STOCK_LAB_API_URL: "http://127.0.0.1:3100" })).toThrow(/regla 1\.4/);
    expect(labApiUrl(LAB_FILE_ENV, { STOCK_LAB_API_URL: "http://localhost:3100" })).toBe("http://localhost:3100");
  });

  it.each(HOSTILE_URLS.filter(([, url]) => url.trim() !== ""))(
    "labApiUrl aborta si el propio archivo lab declara %s",
    (_caso, url) => {
      expect(() => labApiUrl({ ...LAB_FILE_ENV, STOCK_LAB_API_URL: url }, {})).toThrow(/regla 1\.4/);
    },
  );

  it("los mensajes de aborto no repiten las credenciales de la URL", () => {
    const attempt = () => labApiUrl(LAB_FILE_ENV, { STOCK_LAB_API_URL: "http://usuario:clave-secreta@evil.example:3100" });
    expect(attempt).toThrow(/regla 1\.4/);
    expect(attempt).not.toThrow(/clave-secreta/);
  });

  it.each(["http://localhost:3000", "http://127.0.0.1:3000", "http://evil.example:3100"])(
    "createLabClient aborta con STOCK_LAB_API_URL=%s en el entorno del proceso",
    (url) => {
      process.env.STOCK_LAB_API_URL = url;
      expect(() => createLabClient()).toThrow(/regla 1\.4/);
    },
  );

  it("createLabClient con el entorno limpio apunta al BFF del archivo lab", () => {
    delete process.env.STOCK_LAB_API_URL;
    expect(createLabClient().baseUrl).toBe("http://localhost:3100");
  });
});
