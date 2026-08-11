/** Trim accidental whitespace / literal `\r\n` suffixes from Vercel env values. */
function cleanEnvValue(value: string) {
  return value.replace(/\\r\\n$/g, "").replace(/[\r\n]+$/g, "").trim();
}

export function getSupabaseUrl() {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!raw) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL.");
  }

  return cleanEnvValue(raw).replace(/\/$/, "");
}

export function getSupabaseAnonKey() {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!raw) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }

  return cleanEnvValue(raw);
}

export function getSupabaseServiceRoleKey() {
  const raw = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!raw) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }

  return cleanEnvValue(raw);
}
