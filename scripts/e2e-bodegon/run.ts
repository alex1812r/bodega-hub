import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { ApiClient, loadDotEnv } from "./client";
import { createEmptyManifest } from "./manifest";
import {
  phase10Sales,
  phase11SalePayments,
  phase12Exceptions,
  phase13Prices,
  phase14Analytics,
  phase15Users,
  phase1Auth,
  phase2Settings,
  phase3Categories,
  phase4Products,
  phase5Contacts,
  phase6SupplierProducts,
  phase7Inventory,
  phase8Purchases,
  phase9PurchasePayments,
} from "./phases";

async function main() {
  loadDotEnv();

  const baseUrl = process.env.SMOKE_API_BASE_URL ?? "http://localhost:3000";
  const email = process.env.SMOKE_API_EMAIL ?? "admin@example.com";
  const password = process.env.SMOKE_API_PASSWORD ?? "Admin123!";

  process.env.SMOKE_API_EMAIL = email;
  process.env.SMOKE_API_PASSWORD = password;
  process.env.E2E_RUN_SUFFIX =
    process.env.E2E_RUN_SUFFIX ?? Date.now().toString(36).slice(-5);
  console.log(`Run suffix: ${process.env.E2E_RUN_SUFFIX}`);

  console.log("E2E Bodegón La Esquina — backend /api");
  console.log(`Base URL: ${baseUrl}`);
  console.log(`API_DATA_SOURCE (shell): ${process.env.API_DATA_SOURCE ?? "(set in .env)"}`);
  console.log(`User: ${email}`);
  console.log("");

  const client = new ApiClient(baseUrl);
  const manifest = createEmptyManifest(baseUrl);

  try {
    const health = await fetch(`${baseUrl}/api/auth/me`);
    if (!health) {
      console.warn("Warning: could not reach dev server. Start with: npm run dev");
    }
  } catch {
    console.error("ERROR: Dev server not reachable at", baseUrl);
    console.error("Run: npm run dev");
    process.exit(1);
  }

  await phase1Auth(client);
  await phase2Settings(client, manifest);
  await phase3Categories(client, manifest);
  await phase4Products(client, manifest);
  await phase5Contacts(client, manifest);
  await phase6SupplierProducts(client, manifest);
  await phase7Inventory(client, manifest);
  await phase8Purchases(client, manifest);
  await phase9PurchasePayments(client, manifest);
  await phase10Sales(client, manifest);
  await phase11SalePayments(client, manifest);
  await phase12Exceptions(client, manifest);
  await phase13Prices(client, manifest);
  await phase14Analytics(client, manifest);
  await phase15Users(client, manifest);

  manifest.finishedAt = new Date().toISOString();

  const outDir = join(process.cwd(), "scripts", "e2e-bodegon");
  const manifestPath = join(outDir, "manifest.json");
  const lastRunPath = join(outDir, "last-run.json");

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  writeFileSync(
    lastRunPath,
    JSON.stringify(
      {
        manifest,
        steps: client.steps,
        summary: {
          total: client.steps.length,
          passed: client.steps.filter((s) => s.ok).length,
          failed: client.steps.filter((s) => !s.ok).length,
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  const failed = client.steps.filter((s) => !s.ok);
  console.log("\n=== Resumen ===");
  console.log(`Pasos: ${client.steps.length} | OK: ${client.steps.length - failed.length} | FAIL: ${failed.length}`);
  console.log(`Manifiesto: ${manifestPath}`);
  console.log(`Log: ${lastRunPath}`);

  if (failed.length > 0) {
    console.log("\nFallos:");
    for (const f of failed) {
      console.log(`  - [${f.phase}] ${f.step} (${f.status})`);
    }
    process.exit(1);
  }

  console.log("\nE2E Bodegón completado.");
}

main().catch((error: unknown) => {
  console.error("E2E fatal error:", error);
  process.exit(1);
});
