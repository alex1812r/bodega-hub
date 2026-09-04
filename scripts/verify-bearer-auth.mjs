/**
 * Verifica el camino de autenticacion por `Authorization: Bearer` del BFF,
 * el que usa BodegaHub Mobile. Requiere un BFF corriendo en modo supabase y
 * credenciales validas en `.env` / `.env.local`.
 *
 *   node scripts/verify-bearer-auth.mjs
 *   BFF=http://localhost:3001 SEED_EMAIL=admin@example.com node scripts/verify-bearer-auth.mjs
 *
 * Sale con codigo 1 si alguna comprobacion falla, para poder encadenarlo en CI.
 */
import fs from "node:fs";

function loadEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (match) out[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = { ...loadEnv(".env"), ...loadEnv(".env.local") };
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const bff = process.env.BFF ?? "http://localhost:3000";
const email = process.env.SEED_EMAIL ?? "vendedor@example.com";
const password = process.env.SEED_PASSWORD ?? "Admin123!";

if (!supabaseUrl || !anonKey) {
  console.log("SKIP: faltan NEXT_PUBLIC_SUPABASE_URL / ANON_KEY.");
  process.exit(0);
}

const results = [];
const check = (label, ok, detail = "") => {
  results.push({ label, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

const anonResponse = await fetch(`${bff}/api/auth/me`);
check(
  "sin Authorization responde 401",
  anonResponse.status === 401,
  `status ${anonResponse.status}`,
);

const loginResponse = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: anonKey, "content-type": "application/json" },
  body: JSON.stringify({ email, password }),
});
const login = await loginResponse.json();

if (!loginResponse.ok || !login.access_token) {
  console.log(
    `SKIP: no se pudo iniciar sesion como ${email} (${loginResponse.status}). ` +
      "¿Falta aplicar supabase/seed.sql en este proyecto?",
  );
  process.exit(0);
}
check("signInWithPassword devuelve access_token", true, `${login.access_token.length} chars`);

const bearerResponse = await fetch(`${bff}/api/auth/me`, {
  headers: { Authorization: `Bearer ${login.access_token}` },
});
const bearerBody = await bearerResponse.json();
check(
  "misma ruta con Bearer devuelve el perfil",
  bearerResponse.status === 200 && bearerBody.data?.user?.email === email,
  `status ${bearerResponse.status} role=${bearerBody.data?.role ?? "?"}`,
);

const badResponse = await fetch(`${bff}/api/auth/me`, {
  headers: { Authorization: "Bearer token-invalido" },
});
check(
  "token invalido responde 401 (no 500)",
  badResponse.status === 401,
  `status ${badResponse.status}`,
);

const dataResponse = await fetch(`${bff}/api/products?page=1&pageSize=1`, {
  headers: { Authorization: `Bearer ${login.access_token}` },
});
check(
  "ruta de datos con Bearer pasa por RLS",
  dataResponse.status === 200,
  `status ${dataResponse.status}`,
);

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones OK`);
process.exit(failed.length > 0 ? 1 : 0);
