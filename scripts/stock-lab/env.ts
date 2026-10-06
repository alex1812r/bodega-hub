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
