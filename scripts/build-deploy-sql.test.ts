/** @jest-environment node */
/**
 * DEC-03 · los dos archivos de `supabase/patches/deploy/` son exactamente lo que genera
 * `scripts/build-deploy-sql.mjs` (`npm run deploy:sql`) a partir de los parches vigentes, en el orden de despliegue de
 * `docs/despliegue-ux-mejoras.md` §2. Si alguien cambia un parche del plan y no regenera, este test falla.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { isStructuralPatch } from "./stock-lab/pipeline";
import { isUxMejorasPatch, UX_MEJORAS_FIRST_PATCH, UX_MEJORAS_LAST_PATCH } from "./build-deploy-sql.mjs";

const ROOT = resolve(__dirname, "..");
const PATCHES_DIR = resolve(ROOT, "supabase", "patches");
const DEPLOY_DIR = resolve(PATCHES_DIR, "deploy");
const SEPARATOR = /^-- ===== (.+) =====$/gm;

/** Orden de despliegue de docs/despliegue-ux-mejoras.md §2 (NO es el alfabético). */
const BEFORE_BFF = [
  "20261007a-tax-rates.sql",
  "20261007b-tax-rates-store-override.sql",
  "20261008a-register-payment-idempotency.sql",
  "20261009a-product-margin-pct.sql",
  "20261009b-pricing-settings.sql",
  "20261009c-price-review.sql",
  "20261009d-assorted-pack.sql",
  "20261009e-supplier-preferred.sql",
  "20261009f-price-and-product-idempotency.sql",
  "20261010a-purchase-auto-link.sql",
  "20261010b-purchase-inactive-product.sql",
  "20261010d-receive-disassemble.sql",
  "20261010e-pack-recipe-always-disassemble.sql",
  "20261010f-receive-disassemble-invariant.sql",
  "20261011a-inventory-overview.sql",
  "20261011b-adjust-stock-inactive.sql",
  "20261011c-save-pack-recipe.sql",
  "20261012a-save-pack-recipe-always-disassemble.sql",
  "20261012b-price-review-disassemble.sql",
  "20261013a-report-money-views.sql",
  "20261013b-report-inventory-views.sql",
  "20261015a-cash-close-diff-alert.sql",
  "20261017a-reprice-idempotency.sql",
  "20261018a-reports-exclude-draft-sales.sql",
];
const AFTER_BFF = ["20261010c-payments-purchase-rls.sql", "20261011d-pack-recipe-write-lockdown.sql"];

const FILES = [
  ["ux-mejoras-01-antes-del-bff.sql", BEFORE_BFF],
  ["ux-mejoras-02-despues-del-bff.sql", AFTER_BFF],
] as const;

function read(...segments: string[]) {
  return readFileSync(resolve(...segments), "utf8");
}

describe("supabase/patches/deploy (DEC-03)", () => {
  it("los archivos están al día con lo que genera el script (`node scripts/build-deploy-sql.mjs --check`)", () => {
    const result = spawnSync(process.execPath, [resolve(ROOT, "scripts", "build-deploy-sql.mjs"), "--check"], {
      cwd: ROOT,
      encoding: "utf8",
    });

    expect({ status: result.status, stderr: result.stderr.trim() }).toEqual({ status: 0, stderr: "" });
  });

  it.each(FILES)("%s lleva sus parches en el orden exacto de despliegue, cada uno tras su separador", (name, patches) => {
    const content = read(DEPLOY_DIR, name);

    expect([...content.matchAll(SEPARATOR)].map((match) => match[1])).toEqual([...patches]);
  });

  it.each(FILES)("%s contiene cada parche tal cual, sin reescribir SQL", (name, patches) => {
    const content = read(DEPLOY_DIR, name);
    const marks = [...content.matchAll(SEPARATOR)];

    patches.forEach((patch, index) => {
      const start = (marks[index]?.index ?? 0) + marks[index]![0].length + 1;
      // Hasta la línea en blanco que precede al separador siguiente (o el final del archivo).
      const end = index + 1 < marks.length ? (marks[index + 1]!.index ?? 0) - 1 : content.length;

      expect({ patch, same: content.slice(start, end) === read(PATCHES_DIR, patch) }).toEqual({ patch, same: true });
    });
  });

  it.each(FILES)("%s: la cabecera dice qué es, cuándo se ejecuta, que es idempotente y qué debe dar el verify", (name) => {
    const header = read(DEPLOY_DIR, name).split("-- ===== ")[0]!;

    expect(header.split("\n").every((line) => line === "" || line.startsWith("--"))).toBe(true);
    expect(header).toMatch(/verify-patches\.sql/);
    expect(header).toMatch(/Idempotente/);
    expect(header).toMatch(/desplegar el BFF/);
    expect(header).toMatch(/docs\/despliegue-ux-mejoras\.md, seccion 1/);
    expect(header).toMatch(/3 filas|TRES filas/);
    expect(header).toMatch(/NINGUNA fila en fail|ninguna fila en fail/);
  });

  it("el plan ux-mejoras va de 20261007a a 20261018a: un parche posterior (20261019a, otro plan) no se exige en sus listas", () => {
    expect([UX_MEJORAS_FIRST_PATCH, UX_MEJORAS_LAST_PATCH]).toEqual(["20261007a", "20261018a"]);
    expect(
      [
        "20261006z-anterior.sql",
        "20261007a-tax-rates.sql",
        "20261018a-reports-exclude-draft-sales.sql",
        "20261019a-invoice-scans.sql",
        "20261019b-otro-plan.sql",
      ].filter(isUxMejorasPatch),
    ).toEqual(["20261007a-tax-rates.sql", "20261018a-reports-exclude-draft-sales.sql"]);
  });

  it("todo parche estructural del plan (20261007a a 20261018a) está en una de las dos listas, y solo una vez", () => {
    const planPatches = readdirSync(PATCHES_DIR)
      .filter((name) => isStructuralPatch(name) && isUxMejorasPatch(name))
      .sort();
    const listed = [...BEFORE_BFF, ...AFTER_BFF];

    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual(planPatches);
  });

  it("los dos parches que dependen del BFF nuevo solo van en el archivo 02", () => {
    const before = read(DEPLOY_DIR, "ux-mejoras-01-antes-del-bff.sql");

    for (const patch of AFTER_BFF) {
      expect(before).not.toContain(`-- ===== ${patch} =====`);
    }
  });
});
