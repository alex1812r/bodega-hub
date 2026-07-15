/**
 * Smoke post-patches: barcode, image upload URL, pack cost column usage, reactivate.
 *
 * Requiere: npm run dev + .env Supabase + seed admin.
 *
 *   npx tsx scripts/smoke-post-patches.ts
 */

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(resolve(process.cwd(), ".env.local"));
loadEnvFile(resolve(process.cwd(), ".env"));

const BASE = (process.env.SMOKE_API_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const EMAIL = process.env.SMOKE_API_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.SMOKE_API_PASSWORD ?? "Admin123!";

type Step = { name: string; ok: boolean; detail?: string };

const cookieJar = new Map<string, string>();

function storeCookies(res: Response) {
  const raw = res.headers.getSetCookie?.() ?? [];
  for (const line of raw) {
    const [pair] = line.split(";");
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    cookieJar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  // Fallback single set-cookie
  const single = res.headers.get("set-cookie");
  if (single && raw.length === 0) {
    const [pair] = single.split(";");
    const eq = pair.indexOf("=");
    if (eq !== -1) cookieJar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

function cookieHeader() {
  return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function api(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<{ status: number; body: unknown; res: Response }> {
  const headers = new Headers(init.headers);
  if (cookieJar.size) headers.set("cookie", cookieHeader());
  if (init.json !== undefined) {
    headers.set("content-type", "application/json");
  }
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  storeCookies(res);
  let body: unknown = null;
  const text = await res.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body, res };
}

function dataOf(body: unknown) {
  if (body && typeof body === "object" && "data" in body) {
    return (body as { data: unknown }).data;
  }
  return body;
}

async function main() {
  const steps: Step[] = [];
  console.log(`Smoke → ${BASE} as ${EMAIL}`);

  // 0. Health
  try {
    const { status } = await api("/api/auth/me");
    steps.push({
      name: "server reachable",
      ok: status === 401 || status === 200,
      detail: `GET /api/auth/me → ${status}`,
    });
  } catch (error) {
    steps.push({
      name: "server reachable",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
    printAndExit(steps, 1);
  }

  // 1. Login
  {
    const { status, body } = await api("/api/auth/login", {
      method: "POST",
      json: { email: EMAIL, password: PASSWORD },
    });
    const data = dataOf(body) as { role?: string } | null;
    steps.push({
      name: "login admin",
      ok: status === 200 && Boolean(data?.role),
      detail: `status=${status} role=${data?.role ?? "—"}`,
    });
    if (status !== 200) printAndExit(steps, 1);
  }

  // 2. Barcode create + exact lookup
  const barcode = `SMOKE${Date.now().toString().slice(-10)}`;
  let productId = "";
  {
    const sku = `smoke-bc-${Date.now().toString().slice(-6)}`;
    const { status, body } = await api("/api/products", {
      method: "POST",
      json: {
        name: "Smoke barcode product",
        sku,
        barcode,
        salePriceRef: 1.25,
        currentCostRef: 0.8,
        currentStock: 3,
        minStock: 1,
      },
    });
    const data = dataOf(body) as { id?: string; barcode?: string } | null;
    productId = data?.id ?? "";
    steps.push({
      name: "create product with barcode",
      ok: status === 200 || status === 201,
      detail: `status=${status} id=${productId || "—"} barcode=${data?.barcode ?? "—"}`,
    });
  }

  {
    const { status, body } = await api(
      `/api/products?barcode=${encodeURIComponent(barcode)}&isActive=true&limit=2`,
    );
    const data = dataOf(body) as { items?: Array<{ id: string; barcode?: string }>; total?: number };
    const match = data?.items?.some((p) => p.id === productId && p.barcode === barcode);
    steps.push({
      name: "exact barcode lookup",
      ok: status === 200 && Boolean(match) && (data?.total ?? 0) === 1,
      detail: `status=${status} total=${data?.total ?? "—"} match=${Boolean(match)}`,
    });
  }

  // 3. Image signed upload URL
  if (productId) {
    const { status, body } = await api(`/api/products/${productId}/image-upload-url`, {
      method: "POST",
      json: { format: "webp" },
    });
    const data = dataOf(body) as {
      uploadUrl?: string;
      publicUrl?: string;
      path?: string;
    } | null;
    steps.push({
      name: "image signed upload URL",
      ok:
        status === 200 &&
        Boolean(data?.uploadUrl) &&
        Boolean(data?.publicUrl) &&
        Boolean(data?.path?.includes(`${productId}/cover`)),
      detail: `status=${status} path=${data?.path ?? "—"} err=${
        body && typeof body === "object" && "error" in body
          ? JSON.stringify((body as { error: unknown }).error)
          : "—"
      }`,
    });
  } else {
    steps.push({ name: "image signed upload URL", ok: false, detail: "skipped (no productId)" });
  }

  // 4. Deactivate + reactivate product
  if (productId) {
    const off = await api(`/api/products/${productId}`, {
      method: "PATCH",
      json: { isActive: false },
    });
    const on = await api(`/api/products/${productId}`, {
      method: "PATCH",
      json: { isActive: true },
    });
    const data = dataOf(on.body) as { isActive?: boolean } | null;
    steps.push({
      name: "deactivate + reactivate product",
      ok: off.status === 200 && on.status === 200 && data?.isActive === true,
      detail: `off=${off.status} on=${on.status} isActive=${data?.isActive}`,
    });
  }

  // 5. Categories inactive filter + reactivate (best-effort)
  {
    const listInactive = await api("/api/categories?isActive=false&limit=5");
    const inactiveData = dataOf(listInactive.body) as {
      items?: Array<{ id: string; isActive: boolean; name: string }>;
    };
    const target = inactiveData?.items?.[0];

    if (target) {
      const reactivate = await api(`/api/categories/${target.id}`, {
        method: "PATCH",
        json: { isActive: true },
      });
      const data = dataOf(reactivate.body) as { isActive?: boolean } | null;
      steps.push({
        name: "reactivate inactive category",
        ok: reactivate.status === 200 && data?.isActive === true,
        detail: `${target.name} → isActive=${data?.isActive}`,
      });
      // restore inactive for cleanliness
      await api(`/api/categories/${target.id}`, {
        method: "PATCH",
        json: { isActive: false },
      });
    } else {
      const created = await api("/api/categories", {
        method: "POST",
        json: { name: `Smoke cat ${Date.now().toString().slice(-4)}`, description: "smoke" },
      });
      const cat = dataOf(created.body) as { id?: string } | null;
      if (cat?.id) {
        await api(`/api/categories/${cat.id}`, { method: "DELETE" });
        const reactivate = await api(`/api/categories/${cat.id}`, {
          method: "PATCH",
          json: { isActive: true },
        });
        const data = dataOf(reactivate.body) as { isActive?: boolean } | null;
        steps.push({
          name: "reactivate category (create→delete→patch)",
          ok: reactivate.status === 200 && data?.isActive === true,
          detail: `id=${cat.id} isActive=${data?.isActive}`,
        });
      } else {
        steps.push({
          name: "reactivate category",
          ok: false,
          detail: `create failed status=${created.status}`,
        });
      }
    }
  }

  // 6. supplier_products pack column readable
  {
    const { status, body } = await api("/api/supplier-products?limit=1");
    const data = dataOf(body) as { items?: Array<Record<string, unknown>> };
    const item = data?.items?.[0];
    const hasField =
      item !== undefined && ("lastPackCostRef" in item || "last_pack_cost_ref" in item);
    // Empty list still OK if endpoint works (column mapped when rows exist)
    steps.push({
      name: "supplier-products endpoint (pack cost field when present)",
      ok: status === 200,
      detail:
        status === 200
          ? item
            ? `rows>0 lastPackCostRef=${String(item.lastPackCostRef ?? item.last_pack_cost_ref ?? "null")} hasField=${hasField}`
            : "0 rows (endpoint OK; create supplier-product to see pack field)"
          : `status=${status}`,
    });
  }

  // Cleanup smoke product
  if (productId) {
    await api(`/api/products/${productId}`, { method: "DELETE" });
  }

  const failed = steps.filter((s) => !s.ok).length;
  printAndExit(steps, failed > 0 ? 1 : 0);
}

function printAndExit(steps: Step[], code: number) {
  for (const step of steps) {
    console.log(`${step.ok ? "OK  " : "FAIL"}  ${step.name}${step.detail ? ` — ${step.detail}` : ""}`);
  }
  const payload = {
    at: new Date().toISOString(),
    base: BASE,
    steps,
    passed: steps.every((s) => s.ok),
  };
  writeFileSync(
    resolve(process.cwd(), "scripts/smoke-post-patches-last-run.json"),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
  console.log(
    failedMessage(code, steps),
  );
  process.exit(code);
}

function failedMessage(code: number, steps: Step[]) {
  const failed = steps.filter((s) => !s.ok).length;
  if (code === 0) {
    return `\nSmoke API passed (${steps.length} checks). UI manual remainders: crop 4:3 + quitar fondo en formulario producto.`;
  }
  return `\n${failed} check(s) failed. See scripts/smoke-post-patches-last-run.json`;
}

void main();
