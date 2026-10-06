/**
 * Guarda de destino de `e2e:bodegon` (STK-616, regla 1.4 del plan stock-integrity).
 *
 * El script crea categorías, productos, compras, ventas y pagos por el BFF. Solo
 * puede correr contra un entorno local: Supabase y BFF en loopback. No hay
 * variable de escape. Los mensajes nombran solo el host, nunca el valor completo
 * de una variable del entorno.
 */

export const DEFAULT_SMOKE_API_BASE_URL = "http://localhost:3000";

export type EnvRecord = Record<string, string | undefined>;

export type LocalWriteTarget = {
  /** Origen del BFF ya validado: es lo único que debe usarse para las peticiones. */
  baseUrl: string;
  apiHost: string;
  supabaseHost: string;
};

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const LOCAL_ONLY =
  "e2e:bodegon es un script de escritura solo para entornos locales (Supabase y BFF en localhost/127.0.0.1); " +
  "no corre contra ningún otro destino y no tiene variable de escape.";

function loopbackUrl(name: string, value: string | undefined): URL {
  const raw = value?.trim();
  if (!raw) throw new Error(`${name} no está definida. ${LOCAL_ONLY}`);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} no es una URL válida. ${LOCAL_ONLY}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} no es una URL http(s). ${LOCAL_ONLY}`);
  }
  if (!LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error(`${name} apunta al host "${url.hostname}", que no es local. ${LOCAL_ONLY}`);
  }
  if (url.username || url.password) {
    throw new Error(`${name} lleva usuario o contraseña en la URL. ${LOCAL_ONLY}`);
  }
  return url;
}

/**
 * Lanza si el entorno no es local. `env` es el entorno efectivo del proceso (ya
 * con `.env.local`/`.env` cargados); `fileEnv`, lo que declaran esos archivos: si
 * definen otro Supabase, es el que usaría un `npm run dev` normal, así que también
 * tiene que ser loopback aunque el shell declare uno local.
 */
export function assertLocalWriteTarget(env: EnvRecord, fileEnv: EnvRecord = {}): LocalWriteTarget {
  const supabase = loopbackUrl("NEXT_PUBLIC_SUPABASE_URL", env.NEXT_PUBLIC_SUPABASE_URL);
  if (fileEnv.NEXT_PUBLIC_SUPABASE_URL !== undefined) {
    loopbackUrl("NEXT_PUBLIC_SUPABASE_URL (.env.local/.env)", fileEnv.NEXT_PUBLIC_SUPABASE_URL);
  }
  const api = loopbackUrl("SMOKE_API_BASE_URL", env.SMOKE_API_BASE_URL?.trim() || DEFAULT_SMOKE_API_BASE_URL);
  return { baseUrl: api.origin, apiHost: api.hostname, supabaseHost: supabase.hostname };
}
