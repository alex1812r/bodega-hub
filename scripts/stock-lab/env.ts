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

function extractHostname(urlOrConn: string): string {
  const trimmed = urlOrConn.trim();
  if (!trimmed) {
    throw new Error("assertAllowedWriteHost: la URL/conexión está vacía.");
  }
  try {
    // URL soporta esquemas arbitrarios (http, https, postgresql, postgres).
    const hostname = new URL(trimmed).hostname;
    if (!hostname) throw new Error("sin hostname");
    return hostname;
  } catch {
    throw new Error(
      `assertAllowedWriteHost: no se pudo extraer el host de "${trimmed}".`,
    );
  }
}

/**
 * Devuelve el hostname de urlOrConn (acepta http(s):// y postgresql://);
 * lanza Error con mensaje claro si allowedHost está vacío/undefined o no coincide
 * (regla 1.4 del plan: nunca escribir contra producción).
 */
export function assertAllowedWriteHost(
  urlOrConn: string,
  allowedHost: string | undefined,
): string {
  const expected = allowedHost?.trim();
  if (!expected) {
    throw new Error(
      "STOCK_TEST_ALLOW_WRITES_HOST no está definido: me niego a escribir contra una base " +
        "sin host permitido explícito (regla 1.4: nunca contra producción).",
    );
  }
  const hostname = extractHostname(urlOrConn);
  if (hostname.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(
      `El host "${hostname}" no es el host permitido para escrituras ("${expected}"). ` +
        "Abortando para no tocar una base que no sea el laboratorio local (regla 1.4).",
    );
  }
  return hostname;
}
