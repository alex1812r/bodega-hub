/**
 * Verifica que los patches de Supabase existan en el proyecto remoto.
 *
 * Uso (con .env cargado y proyecto activo):
 *   npx tsx scripts/verify-supabase-patches.ts
 *
 * No imprime secretos. Sale con codigo 1 si algo falla.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) {
    return;
  }

  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const eq = trimmed.indexOf("=");
    if (eq === -1) {
      continue;
    }

    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(resolve(process.cwd(), ".env.local"));
loadEnvFile(resolve(process.cwd(), ".env"));

const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!baseUrl || !serviceKey) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env");
  process.exit(1);
}

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
};

type Check = { name: string; ok: boolean; detail?: string };

async function check(name: string, run: () => Promise<Check>): Promise<Check> {
  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { name, ok: false, detail: message };
  }
}

async function main() {
  console.log(`Probing ${baseUrl} ...`);

  const checks: Check[] = [];

  checks.push(
    await check("DNS / reachability", async () => {
      const response = await fetch(`${baseUrl}/auth/v1/health`, { method: "GET" });
      return {
        name: "DNS / reachability",
        ok: response.ok || response.status < 500,
        detail: `HTTP ${response.status}`,
      };
    }),
  );

  checks.push(
    await check("products.barcode", async () => {
      const response = await fetch(`${baseUrl}/rest/v1/products?select=id,barcode&limit=1`, {
        headers,
      });
      const text = await response.text();
      return {
        name: "products.barcode",
        ok: response.ok,
        detail: response.ok ? "column present" : text.slice(0, 200),
      };
    }),
  );

  checks.push(
    await check("supplier_products.last_pack_cost_ref", async () => {
      const response = await fetch(
        `${baseUrl}/rest/v1/supplier_products?select=id,last_pack_cost_ref&limit=1`,
        { headers },
      );
      const text = await response.text();
      return {
        name: "supplier_products.last_pack_cost_ref",
        ok: response.ok,
        detail: response.ok ? "column present" : text.slice(0, 200),
      };
    }),
  );

  checks.push(
    await check("bucket product-images", async () => {
      const response = await fetch(`${baseUrl}/storage/v1/bucket`, { headers });
      const text = await response.text();
      if (!response.ok) {
        return { name: "bucket product-images", ok: false, detail: text.slice(0, 200) };
      }

      const buckets = JSON.parse(text) as Array<{ name?: string; id?: string }>;
      const ok = buckets.some((bucket) => bucket.id === "product-images" || bucket.name === "product-images");
      return {
        name: "bucket product-images",
        ok,
        detail: ok ? "found" : `buckets: ${buckets.map((b) => b.name ?? b.id).join(", ") || "(none)"}`,
      };
    }),
  );

  let failed = 0;
  for (const item of checks) {
    const mark = item.ok ? "OK " : "FAIL";
    console.log(`${mark}  ${item.name}${item.detail ? ` — ${item.detail}` : ""}`);
    if (!item.ok) {
      failed += 1;
    }
  }

  if (failed > 0) {
    console.error(
      `\n${failed} check(s) failed. Apply supabase/patches/apply-all-pending.sql in SQL Editor, then re-run.`,
    );
    process.exit(1);
  }

  console.log("\nAll patch probes passed.");
}

void main();
