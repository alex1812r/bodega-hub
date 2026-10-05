/**
 * Logica pura del pipeline stock-lab (sin pg, sin fs): seleccion y orden de
 * parches, edicion de supabase/config.toml y lectura de verify-patches.
 * Se testea en jest (pipeline.test.ts); db-up.ts es quien hace I/O.
 */

export const SCHEMA_FILE = "supabase-schema.sql";
export const SEED_FILE = "seed.sql";
export const SEED_SUPERADMIN_PATCH = "20260716c-seed-superadmin.sql";
export const VERIFY_PATCH = "verify-patches.sql";
export const APPLY_ALL_PATCH = "apply-all-pending.sql";

/** Patrones que marcan un parche como no estructural (one-shots, consultas, diagnosticos, agregadores). */
const EXCLUDED_NAME_PATTERNS = [/one-shot/, /query/, /diagnostic/];

/**
 * Parches que por nombre parecen estructurales pero son correcciones de datos
 * de produccion (ids hardcoded); en una base limpia no aportan esquema.
 */
export const DATA_ONLY_PATCHES: ReadonlyArray<string> = [
  "20260810d-fix-existing-purchase-payment.sql", // pago parcial de una compra concreta
  "20260819b-fix-cash-close-cab7b096.sql", // corrige un cierre de caja concreto
  "20260901b-transfer-efectivo-ves-fixed.sql", // backfill baul con store/user hardcoded
  "20260901c-transfer-efectivo-caja-direct.sql", // idem
  "20260901d-transfer-ref-caja-direct.sql", // idem
  "20260902-fix-vault-inflacion-efectivo.sql", // revierte backfills anteriores en prod
];

/**
 * Orden explicito cuando el nombre de archivo no refleja la dependencia real.
 * Cada entrada es [parche, debe-ir-despues-de]. El sufijo "a" ordena DESPUES
 * del archivo sin sufijo, pero esos parches "a" agregan valores de enum que el
 * parche principal usa (y PostgreSQL exige que el enum exista en una
 * transaccion previa, error 55P04).
 */
export const PATCH_ORDER_OVERRIDES: ReadonlyArray<readonly [string, string]> = [
  ["20260716-multi-store.sql", "20260716a-user-role-superadmin.sql"],
  ["20260811-pack-unit-conversion.sql", "20260811a-stock-movement-conversion-enum.sql"],
];

export function isStructuralPatch(fileName: string): boolean {
  if (!fileName.endsWith(".sql")) return false;
  if (fileName === APPLY_ALL_PATCH || fileName === VERIFY_PATCH || fileName === SEED_SUPERADMIN_PATCH) return false;
  if (DATA_ONLY_PATCHES.includes(fileName)) return false;
  return !EXCLUDED_NAME_PATTERNS.some((re) => re.test(fileName));
}

/** Parches estructurales ordenados por nombre (cronologico) con los overrides aplicados. */
export function selectStructuralPatches(fileNames: string[]): string[] {
  const ordered = fileNames.filter(isStructuralPatch).sort((a, b) => a.localeCompare(b, "en"));
  for (const [patch, after] of PATCH_ORDER_OVERRIDES) {
    const from = ordered.indexOf(patch);
    const anchor = ordered.indexOf(after);
    if (from === -1 || anchor === -1 || from > anchor) continue;
    ordered.splice(from, 1);
    ordered.splice(ordered.indexOf(after) + 1, 0, patch);
  }
  return ordered;
}

export const STOCK_LAB_PROJECT_ID = "control-ventas-stock-lab";

/** Secciones de config.toml que se apagan para arrancar mas rapido; auth/storage/rest se mantienen. */
const DISABLED_SECTIONS = ["db.seed", "studio", "analytics", "edge_runtime"];

/**
 * Puertos fijos por seccion. Los 5432x por defecto caen en el rango dinamico
 * de Windows (49152+), donde Hyper-V/WinNAT reserva bloques al azar y Docker
 * no puede publicar el puerto; 1432x queda fuera de ese rango.
 */
export const STOCK_LAB_PORTS: ReadonlyArray<readonly [section: string, key: string, port: number]> = [
  ["api", "port", 14321],
  ["db", "port", 14322],
  ["db", "shadow_port", 14320],
  ["local_smtp", "port", 14324],
];

/** Fija project_id, puertos y apaga secciones en el config.toml generado por `supabase init`. Idempotente. */
export function applyStockLabConfig(toml: string): string {
  const lines = toml.split(/\r?\n/);
  let section = "";
  let projectIdSet = false;
  const out = lines.map((line) => {
    const header = /^\[([^\]]+)\]\s*$/.exec(line);
    if (header) {
      section = header[1];
      return line;
    }
    if (section === "" && /^project_id\s*=/.test(line)) {
      projectIdSet = true;
      return `project_id = "${STOCK_LAB_PROJECT_ID}"`;
    }
    if (DISABLED_SECTIONS.includes(section) && /^enabled\s*=/.test(line)) return "enabled = false";
    const port = STOCK_LAB_PORTS.find(([s, key]) => s === section && new RegExp(`^${key}\\s*=`).test(line));
    if (port) return `${port[1]} = ${port[2]}`;
    return line;
  });
  if (!projectIdSet) out.unshift(`project_id = "${STOCK_LAB_PROJECT_ID}"`);
  return out.join("\n");
}

export type VerifyRow = { check_name: string; ok: boolean };

export function failedChecks(rows: ReadonlyArray<VerifyRow>): string[] {
  return rows.filter((r) => !r.ok).map((r) => r.check_name);
}
