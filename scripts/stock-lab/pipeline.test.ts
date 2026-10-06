import { readdirSync } from "node:fs";
import { resolve } from "node:path";

import {
  DATA_ONLY_PATCHES,
  PATCH_ORDER_OVERRIDES,
  STOCK_LAB_PROJECT_ID,
  applyStockLabConfig,
  failedChecks,
  isStructuralPatch,
  selectStructuralPatches,
} from "./pipeline";

const PATCHES = [
  "verify-patches.sql",
  "20260909-create-sale-with-payments.sql",
  "20260716c-seed-superadmin.sql",
  "20260716-multi-store.sql",
  "20260716b-multi-store-views.sql",
  "20260901-query-cash-balances.sql",
  "20260812-one-shot-backfill-vault-informal-purchase.sql",
  "20260901-diagnostic-vault.sql",
  "apply-all-pending.sql",
  "20260705-supplier-product-pack-cost.sql",
  "20260716a-user-role-superadmin.sql",
  "20260811a-stock-movement-conversion-enum.sql",
  "20260811-pack-unit-conversion.sql",
  "20260906b-assistant-queries.sql",
  "20260819b-fix-cash-close-cab7b096.sql",
  "20261005-stock-integrity-views.sql",
  "README.md",
];

describe("selectStructuralPatches", () => {
  const selected = selectStructuralPatches(PATCHES);

  it("ordena por nombre de archivo (cronologico) con los enums antes de quien los usa", () => {
    expect(selected).toEqual([
      "20260705-supplier-product-pack-cost.sql",
      "20260716a-user-role-superadmin.sql",
      "20260716-multi-store.sql",
      "20260716b-multi-store-views.sql",
      "20260811a-stock-movement-conversion-enum.sql",
      "20260811-pack-unit-conversion.sql",
      "20260906b-assistant-queries.sql",
      "20260909-create-sale-with-payments.sql",
      "20261005-stock-integrity-views.sql",
    ]);
  });

  it("incluye el RPC atomico de venta, las vistas de integridad y excluye el seed de superadmin", () => {
    expect(selected).toContain("20260909-create-sale-with-payments.sql");
    expect(selected).toContain("20261005-stock-integrity-views.sql");
    expect(selected).not.toContain("20260716c-seed-superadmin.sql");
  });

  it("excluye one-shot, query, diagnostic, agregadores, data-only y no .sql", () => {
    for (const name of [
      "20260812-one-shot-backfill-vault-informal-purchase.sql",
      "20260901-query-cash-balances.sql",
      "20260901-diagnostic-vault.sql",
      "apply-all-pending.sql",
      "verify-patches.sql",
      "20260819b-fix-cash-close-cab7b096.sql",
      "README.md",
    ]) {
      expect(selected).not.toContain(name);
    }
    expect(DATA_ONLY_PATCHES).toContain("20260819b-fix-cash-close-cab7b096.sql");
  });

  it("no pierde ni duplica parches al aplicar overrides", () => {
    expect(new Set(selected).size).toBe(selected.length);
    for (const [patch, after] of PATCH_ORDER_OVERRIDES) {
      expect(selected.indexOf(patch)).toBeGreaterThan(selected.indexOf(after));
    }
  });
});

describe("one-shot de resincronizacion de stock (STK-702)", () => {
  const ONE_SHOT = "20261006z-one-shot-stock-resync.sql";
  const realPatches = readdirSync(resolve(__dirname, "..", "..", "supabase", "patches"));

  it("existe en supabase/patches y no es un parche estructural", () => {
    expect(realPatches).toContain(ONE_SHOT);
    expect(isStructuralPatch(ONE_SHOT)).toBe(false);
  });

  it("no entra en el pipeline del laboratorio sobre el listado real de parches", () => {
    const selected = selectStructuralPatches(realPatches);
    expect(selected).not.toContain(ONE_SHOT);
    expect(selected.filter((name) => /one-shot/.test(name))).toEqual([]);
    // El resto de la serie 20261006 si se aplica: el filtro no se la lleva por delante.
    expect(selected).toContain("20261006e-stock-ledger-strict.sql");
  });
});

describe("applyStockLabConfig", () => {
  const generated = [
    "# comment",
    'project_id = "agent-xyz"',
    "",
    "[api]",
    "enabled = true",
    "port = 54321",
    "",
    "[db]",
    "port = 54322",
    "shadow_port = 54320",
    "",
    "[db.pooler]",
    "enabled = false",
    "port = 54329",
    "",
    "[db.seed]",
    "enabled = true",
    'sql_paths = ["./seed.sql"]',
    "",
    "[studio]",
    "enabled = true",
    "",
    "[auth]",
    "enabled = true",
    "",
    "[storage]",
    "enabled = true",
    "",
    "[local_smtp]",
    "enabled = true",
    "port = 54324",
    "",
    "[edge_runtime]",
    "enabled = true",
    "",
    "[analytics]",
    "enabled = true",
  ].join("\n");

  it("fija project_id y apaga seed/studio/analytics/edge_runtime manteniendo api/auth/storage", () => {
    const result = applyStockLabConfig(generated);
    expect(result).toContain(`project_id = "${STOCK_LAB_PROJECT_ID}"`);
    expect(result).toMatch(/\[db\.seed\]\nenabled = false/);
    expect(result).toMatch(/\[studio\]\nenabled = false/);
    expect(result).toMatch(/\[analytics\]\nenabled = false/);
    expect(result).toMatch(/\[edge_runtime\]\nenabled = false/);
    expect(result).toMatch(/\[api\]\nenabled = true/);
    expect(result).toMatch(/\[auth\]\nenabled = true/);
    expect(result).toMatch(/\[storage\]\nenabled = true/);
  });

  it("mueve api/db/shadow/smtp fuera del rango dinamico de Windows y no toca el pooler", () => {
    const result = applyStockLabConfig(generated);
    expect(result).toMatch(/\[api\]\nenabled = true\nport = 14321/);
    expect(result).toMatch(/\[db\]\nport = 14322\nshadow_port = 14320/);
    expect(result).toMatch(/\[db\.pooler\]\nenabled = false\nport = 54329/);
    expect(result).toMatch(/\[local_smtp\]\nenabled = true\nport = 14324/);
  });

  it("es idempotente", () => {
    const once = applyStockLabConfig(generated);
    expect(applyStockLabConfig(once)).toBe(once);
  });
});

describe("failedChecks", () => {
  it("devuelve solo los nombres con ok = false", () => {
    expect(
      failedChecks([
        { check_name: "a", ok: true },
        { check_name: "b", ok: false },
        { check_name: "c", ok: false },
      ]),
    ).toEqual(["b", "c"]);
  });
});
