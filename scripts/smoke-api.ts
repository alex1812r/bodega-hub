/**
 * Smoke test for /api with API_DATA_SOURCE=supabase.
 *
 * Prerequisites:
 *   1. `npm run dev` running (default http://localhost:3000)
 *   2. `.env.local` with Supabase keys and API_DATA_SOURCE=supabase
 *   3. Optional: SMOKE_API_EMAIL + SMOKE_API_PASSWORD for authenticated calls
 *
 * Run:
 *   npx tsx scripts/smoke-api.ts
 *
 * Without credentials the script prints setup steps and exits 0 (dry-run).
 */

const BASE_URL = process.env.SMOKE_API_BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.SMOKE_API_EMAIL;
const PASSWORD = process.env.SMOKE_API_PASSWORD;

type JsonRecord = Record<string, unknown>;

async function request(
  path: string,
  init?: RequestInit & { cookie?: string },
): Promise<{ ok: boolean; status: number; body: JsonRecord | null; setCookie?: string }> {
  const headers = new Headers(init?.headers);
  if (init?.cookie) {
    headers.set("cookie", init.cookie);
  }

  const response = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  let body: JsonRecord | null = null;

  try {
    body = (await response.json()) as JsonRecord;
  } catch {
    body = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    body,
    setCookie: response.headers.get("set-cookie") ?? undefined,
  };
}

function logStep(label: string, result: { ok: boolean; status: number; body: JsonRecord | null }) {
  const status = result.ok ? "OK" : "FAIL";
  console.log(`  [${status}] ${label} -> ${result.status}`);
  if (!result.ok && result.body?.error) {
    console.log("       ", JSON.stringify(result.body.error));
  }
}

async function main() {
  console.log("Smoke API — Supabase backend");
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`API_DATA_SOURCE (local env): ${process.env.API_DATA_SOURCE ?? "(not set in shell)"}`);
  console.log("");

  if (!EMAIL || !PASSWORD) {
    console.log("No SMOKE_API_EMAIL / SMOKE_API_PASSWORD — dry-run mode.");
    console.log("");
    console.log("To run live checks:");
    console.log("  1. Start dev server: npm run dev");
    console.log("  2. Set in .env.local: API_DATA_SOURCE=supabase");
    console.log("  3. Export credentials:");
    console.log("       SMOKE_API_EMAIL=admin@example.com");
    console.log("       SMOKE_API_PASSWORD=your-password");
    console.log("  4. Run: npx tsx scripts/smoke-api.ts");
    console.log("");
    console.log("Endpoints exercised when credentials are set:");
    console.log("  POST /api/auth/login");
    console.log("  GET  /api/auth/me");
    console.log("  GET  /api/dashboard/summary");
    console.log("  GET  /api/products?limit=5");
    console.log("  GET  /api/exchange-rates/current");
    process.exit(0);
  }

  let cookie = "";

  console.log("1. Login");
  const login = await request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  logStep("POST /api/auth/login", login);

  if (!login.ok) {
    process.exit(1);
  }

  if (login.setCookie) {
    cookie = login.setCookie.split(";")[0] ?? "";
  }

  console.log("");
  console.log("2. Authenticated reads");

  const me = await request("/api/auth/me", { cookie });
  logStep("GET /api/auth/me", me);

  const summary = await request("/api/dashboard/summary", { cookie });
  logStep("GET /api/dashboard/summary", summary);

  const products = await request("/api/products?limit=5", { cookie });
  logStep("GET /api/products?limit=5", products);

  const rate = await request("/api/exchange-rates/current", { cookie });
  logStep("GET /api/exchange-rates/current", rate);

  const allOk = [me, summary, products, rate].every((r) => r.ok);
  console.log("");
  console.log(allOk ? "Smoke test passed." : "Smoke test failed.");
  process.exit(allOk ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error("Smoke test error:", error);
  process.exit(1);
});
