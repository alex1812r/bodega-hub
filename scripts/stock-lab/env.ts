/**
 * Stub temporal (STK-101). La version definitiva la escribe STK-102; el
 * contrato exportado es el acordado y no debe cambiar aqui.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const STOCK_LAB_ENV_FILE = ".env.stock-lab";
export const STOCK_LAB_ENV_EXAMPLE = ".env.stock-lab.example";

export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    out[key] = line
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return out;
}

/** Lee .env.stock-lab (si no existe, .env.stock-lab.example) desde rootDir (default: raiz del repo). Lanza si no hay ninguno. */
export function loadStockLabEnv(rootDir: string = resolve(__dirname, "../..")): Record<string, string> {
  for (const name of [STOCK_LAB_ENV_FILE, STOCK_LAB_ENV_EXAMPLE]) {
    const file = resolve(rootDir, name);
    if (existsSync(file)) return parseEnvFile(readFileSync(file, "utf8"));
  }
  throw new Error(`No existe ${STOCK_LAB_ENV_FILE} ni ${STOCK_LAB_ENV_EXAMPLE} en ${rootDir}`);
}

/** Devuelve el hostname de urlOrConn; lanza Error si allowedHost esta vacio o no coincide (regla 1.4). */
export function assertAllowedWriteHost(urlOrConn: string, allowedHost: string | undefined): string {
  const allowed = allowedHost?.trim();
  if (!allowed) {
    throw new Error("STOCK_TEST_ALLOW_WRITES_HOST esta vacio: no se escribe en ninguna base sin host permitido (regla 1.4)");
  }
  let host: string;
  try {
    host = new URL(urlOrConn).hostname;
  } catch {
    throw new Error("STOCK_LAB_DB_URL no es una URL valida");
  }
  if (host !== allowed) {
    throw new Error(`Host '${host}' no coincide con STOCK_TEST_ALLOW_WRITES_HOST='${allowed}' (regla 1.4)`);
  }
  return host;
}
