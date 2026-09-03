/** Configuracion de red leida de `EXPO_PUBLIC_*` (ver `.env.example`). */

const DEFAULT_BASE_URL = "http://10.0.2.2:3000";

function clean(value: string | undefined) {
  return value?.trim().replace(/\/$/, "") ?? "";
}

export function getApiBaseUrl() {
  return clean(process.env.EXPO_PUBLIC_API_BASE_URL) || DEFAULT_BASE_URL;
}

export function getSupabaseUrl() {
  return clean(process.env.EXPO_PUBLIC_SUPABASE_URL);
}

export function getSupabaseAnonKey() {
  return process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
}

/** Sin credenciales, la app solo puede trabajar contra el BFF en modo mock. */
export function hasSupabaseCredentials() {
  return getSupabaseUrl().length > 0 && getSupabaseAnonKey().length > 0;
}

export function isDemoAuthEnabled() {
  return process.env.EXPO_PUBLIC_ALLOW_DEMO_AUTH === "true";
}

export const requestTimeoutMs = 20_000;
