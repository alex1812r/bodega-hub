/**
 * Carga del entorno del laboratorio de stock (plan stock-integrity, fase 1).
 *
 * Solo lee `.env.stock-lab` / `.env.stock-lab.example`; nunca `.env` ni
 * `.env.local`, que apuntan a producción.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const STOCK_LAB_ENV_FILE = ".env.stock-lab";
export const STOCK_LAB_ENV_EXAMPLE = ".env.stock-lab.example";
/** Puerto del BFF del laboratorio cuando el archivo lab no declara `PORT`. */
export const DEFAULT_LAB_PORT = "3100";

function repoRootDir(): string {
  // scripts/stock-lab/env.ts -> raíz del repo = dos niveles arriba.
  // `__dirname` funciona tanto en tsx (CJS, el repo no es "type: module") como en jest.
  return resolve(__dirname, "..", "..");
}

/** Parsea líneas KEY=VALUE; ignora comentarios/vacías; quita comillas simples/dobles envolventes. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let value = line.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Lee .env.stock-lab desde rootDir (default: raíz del repo = dos niveles arriba
 * de este archivo); si no existe, .env.stock-lab.example; lanza Error si no hay ninguno.
 */
export function loadStockLabEnv(rootDir?: string): Record<string, string> {
  const root = rootDir ?? repoRootDir();
  for (const name of [STOCK_LAB_ENV_FILE, STOCK_LAB_ENV_EXAMPLE]) {
    const filePath = resolve(root, name);
    if (existsSync(filePath)) {
      return parseEnvFile(readFileSync(filePath, "utf8"));
    }
  }
  throw new Error(
    `No se encontró ${STOCK_LAB_ENV_FILE} ni ${STOCK_LAB_ENV_EXAMPLE} en ${root}. ` +
      `Copia ${STOCK_LAB_ENV_EXAMPLE} a ${STOCK_LAB_ENV_FILE} (Supabase local).`,
  );
}

type TargetKind = "pg" | "http";
type Target = { kind: TargetKind; hostname: string; port: string };

const TARGET_PROTOCOLS: Record<string, { kind: TargetKind; defaultPort: string }> = {
  "http:": { kind: "http", defaultPort: "80" },
  "https:": { kind: "http", defaultPort: "443" },
  "postgres:": { kind: "pg", defaultPort: "5432" },
  "postgresql:": { kind: "pg", defaultPort: "5432" },
};

/**
 * `pg` (pg-connection-string) copia TODOS los parámetros de consulta a su config:
 * `host`, `hostaddr`, `port`, `service`, `user`… pisan lo que dice la URL. Solo se
 * admiten los que no pueden cambiar el destino; cualquier otro aborta.
 */
const SAFE_PG_PARAMS = new Set([
  "application_name",
  "client_encoding",
  "connect_timeout",
  "fallback_application_name",
  "options",
  "ssl",
  "sslmode",
]);

const RULE = "(regla 1.4: nunca contra producción)";

function parseTarget(urlOrConn: string): Target {
  const trimmed = urlOrConn.trim();
  if (!trimmed) {
    throw new Error("assertAllowedWriteHost: la URL/conexión está vacía.");
  }
  let url: URL;
  try {
    // Sin URL base, a propósito: `pg` resuelve contra `postgres://base`, así que una
    // ruta de socket (`/var/run/…`) o una URL relativa (`//host/db`) aquí no parsea.
    url = new URL(trimmed);
    if (!url.hostname) throw new Error("sin hostname");
  } catch {
    throw new Error(
      `assertAllowedWriteHost: no se pudo extraer el host de "${trimmed}".`,
    );
  }
  const protocol = TARGET_PROTOCOLS[url.protocol];
  if (!protocol) {
    throw new Error(
      `assertAllowedWriteHost: esquema "${url.protocol}" no admitido (solo http, https, postgres y postgresql) ${RULE}.`,
    );
  }
  if (protocol.kind === "pg") {
    for (const name of url.searchParams.keys()) {
      if (!SAFE_PG_PARAMS.has(name)) {
        throw new Error(
          `La cadena de conexión lleva el parámetro "${name}", que puede cambiar el destino real de la conexión. ` +
            `El host y el puerto van solo en la URL ${RULE}.`,
        );
      }
    }
  }
  return { kind: protocol.kind, hostname: url.hostname, port: url.port || protocol.defaultPort };
}

/** Puertos del laboratorio según el archivo lab: solo cuentan las URLs que apuntan al host permitido. */
function labPorts(labEnv: Record<string, string | undefined>, labHost: string, kind: TargetKind): string[] {
  const ports: string[] = [];
  const urls = kind === "pg" ? [labEnv.STOCK_LAB_DB_URL] : [labEnv.NEXT_PUBLIC_SUPABASE_URL];
  for (const value of urls) {
    if (!value) continue;
    try {
      const target = parseTarget(value);
      if (target.kind === kind && target.hostname.toLowerCase() === labHost.toLowerCase()) ports.push(target.port);
    } catch {
      // Una URL inválida en el archivo no aporta ningún puerto permitido.
    }
  }
  // BFF del laboratorio (`npm run stock-lab:start`).
  if (kind === "http" && labEnv.PORT?.trim()) ports.push(labEnv.PORT.trim());
  return ports;
}

/**
 * Devuelve el hostname de urlOrConn (acepta http(s):// y postgres(ql)://) si apunta
 * al laboratorio; si no, lanza Error (regla 1.4 del plan: nunca escribir contra producción).
 *
 * La referencia es SIEMPRE el archivo lab (`labEnv`, por defecto `.env.stock-lab`),
 * nunca `process.env`:
 * - `allowedHost` es obligatorio y tiene que ser el `STOCK_TEST_ALLOW_WRITES_HOST` del archivo
 *   (un host «permitido» heredado del entorno no vale);
 * - host Y puerto tienen que ser los del archivo (`STOCK_LAB_DB_URL` para Postgres;
 *   `NEXT_PUBLIC_SUPABASE_URL` y `PORT` para http);
 * - una cadena de Postgres no puede llevar parámetros que cambien el destino
 *   (`host`, `hostaddr`, `port`, `service`…), ni ser un socket.
 */
export function assertAllowedWriteHost(
  urlOrConn: string,
  allowedHost: string | undefined,
  labEnv: Record<string, string | undefined> = loadStockLabEnv(),
): string {
  const expected = assertDeclaredAllowedHost(allowedHost, labEnv);
  const target = parseTarget(urlOrConn);
  if (target.hostname.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(
      `El host "${target.hostname}" no es el host permitido para escrituras ("${expected}"). ` +
        "Abortando para no tocar una base que no sea el laboratorio local (regla 1.4).",
    );
  }
  const ports = labPorts(labEnv, expected, target.kind);
  if (!ports.includes(target.port)) {
    throw new Error(
      `El puerto ${target.port} de "${target.hostname}" no es un puerto del laboratorio ` +
        `(${ports.join(", ") || "ninguno definido"} según ${STOCK_LAB_ENV_FILE}). ` +
        "Abortando para no tocar una base que no sea el laboratorio local (regla 1.4).",
    );
  }
  return target.hostname;
}

/** El host permitido declarado tiene que ser el del archivo lab; devuelve el del archivo. */
function assertDeclaredAllowedHost(
  allowedHost: string | undefined,
  labEnv: Record<string, string | undefined>,
): string {
  const declared = allowedHost?.trim();
  const expected = labEnv.STOCK_TEST_ALLOW_WRITES_HOST?.trim();
  if (!declared || !expected) {
    throw new Error(
      `STOCK_TEST_ALLOW_WRITES_HOST no está definido${declared ? ` en ${STOCK_LAB_ENV_FILE}` : ""}: ` +
        `me niego a escribir contra una base sin host permitido explícito ${RULE}.`,
    );
  }
  if (declared.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(
      `El host permitido declarado ("${declared}") no es el de ${STOCK_LAB_ENV_FILE} ("${expected}"). ` +
        `El host permitido sale solo del archivo del laboratorio, no del entorno heredado ${RULE}.`,
    );
  }
  return expected;
}

// ---------------------------------------------------------------------------
// BFF del laboratorio
// ---------------------------------------------------------------------------

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * `localhost` y `127.0.0.1` (y `::1`) son el mismo loopback. Devuelve true si
 * ambos hosts son loopback o si son iguales (case-insensitive).
 */
export function isLoopbackEquivalent(hostA: string, hostB: string | undefined): boolean {
  const a = hostA.trim().toLowerCase();
  const b = hostB?.trim().toLowerCase() ?? "";
  if (!a || !b) return false;
  if (a === b) return true;
  return LOOPBACK_HOSTS.has(a) && LOOPBACK_HOSTS.has(b);
}

function labApiPort(labEnv: Record<string, string | undefined>): string {
  return labEnv.PORT?.trim() || DEFAULT_LAB_PORT;
}

/**
 * Única puerta de la URL del BFF: `http`, host loopback, sin usuario/contraseña y
 * con el puerto del BFF del laboratorio (`PORT` del archivo lab, o 3100). Un
 * `next dev` normal del repo escucha en loopback con el entorno de producción, así
 * que «es loopback» no basta. Los mensajes nombran solo el host, nunca la URL.
 */
function parseLabApiUrl(url: string, labEnv: Record<string, string | undefined>): URL {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
    if (!parsed.hostname) throw new Error("sin hostname");
  } catch {
    throw new Error(`La URL del BFF del laboratorio no es válida: no se pudo extraer el host ${RULE}.`);
  }
  if (!isLoopbackEquivalent(parsed.hostname, "localhost")) {
    throw new Error(
      `El host "${parsed.hostname}" no es el host permitido para el BFF del laboratorio (solo loopback) ${RULE}.`,
    );
  }
  if (parsed.username || parsed.password) {
    throw new Error(`La URL del BFF del laboratorio no puede llevar usuario ni contraseña ${RULE}.`);
  }
  if (parsed.protocol !== "http:") {
    throw new Error(
      `El esquema "${parsed.protocol}" no es el del BFF del laboratorio (solo http en loopback) ${RULE}.`,
    );
  }
  const port = parsed.port || "80";
  const expectedPort = labApiPort(labEnv);
  if (port !== expectedPort) {
    throw new Error(
      `El puerto ${port} de "${parsed.hostname}" no es el del BFF del laboratorio ` +
        `(${expectedPort} según ${STOCK_LAB_ENV_FILE}): ahí puede escuchar una app con otro entorno ${RULE}.`,
    );
  }
  return parsed;
}

/**
 * Valida que `url` sea el BFF del laboratorio (ver `parseLabApiUrl`) y que
 * `allowedHost` sea el del archivo lab. Devuelve el hostname.
 */
export function assertLabApiHost(
  url: string,
  allowedHost: string | undefined,
  labEnv: Record<string, string | undefined> = loadStockLabEnv(),
): string {
  assertDeclaredAllowedHost(allowedHost, labEnv);
  return parseLabApiUrl(url, labEnv).hostname;
}

/**
 * URL (origen) del BFF del laboratorio, ya validada. Sale SOLO del archivo lab:
 * `STOCK_LAB_API_URL` si lo declara, si no `http://localhost:<PORT>`. Un
 * `STOCK_LAB_API_URL` heredado del entorno no la cambia: si no coincide con la del
 * archivo, se aborta en vez de ignorarlo en silencio.
 */
export function labApiUrl(
  labEnv: Record<string, string | undefined> = loadStockLabEnv(),
  processEnv: Record<string, string | undefined> = process.env,
): string {
  const declared = labEnv.STOCK_LAB_API_URL?.trim() || `http://localhost:${labApiPort(labEnv)}`;
  const origin = parseLabApiUrl(declared, labEnv).origin;
  const inherited = processEnv.STOCK_LAB_API_URL?.trim();
  if (inherited && parseLabApiUrl(inherited, labEnv).origin !== origin) {
    throw new Error(
      `STOCK_LAB_API_URL del entorno heredado no es la URL del BFF de ${STOCK_LAB_ENV_FILE} (${origin}). ` +
        `La URL del BFF sale solo del archivo del laboratorio ${RULE}.`,
    );
  }
  return origin;
}
