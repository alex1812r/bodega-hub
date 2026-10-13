// Genera los dos archivos SQL de despliegue del plan ux-mejoras (DEC-03):
//
//   supabase/patches/deploy/ux-mejoras-01-antes-del-bff.sql
//   supabase/patches/deploy/ux-mejoras-02-despues-del-bff.sql
//
//   node scripts/build-deploy-sql.mjs           # los (re)escribe      -> npm run deploy:sql
//   node scripts/build-deploy-sql.mjs --check   # no escribe; exit 1 si no coinciden con lo que generaría
//
// Cada archivo es su cabecera + los parches de `supabase/patches/` de la lista de abajo, EN ESE ORDEN y TAL CUAL
// (byte a byte: este script no reescribe SQL), con una línea `-- ===== <archivo> =====` antes de cada uno.
//
// El orden NO es el alfabético de los nombres: es el de docs/despliegue-ux-mejoras.md, sección 2, que es la única
// fuente del orden de despliegue. Si se añade o se mueve un parche, se cambia la lista aquí, se corre
// `npm run deploy:sql` y se actualiza ese documento; `scripts/build-deploy-sql.test.ts` falla si los archivos de
// `deploy/` quedan desfasados o si un parche del plan no está en ninguna de las dos listas.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PATCHES_DIR = resolve(ROOT, "supabase/patches");
const DEPLOY_DIR = resolve(PATCHES_DIR, "deploy");

/** Antes de desplegar el BFF, en este orden exacto. */
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

/** Después de desplegar el BFF nuevo (nunca antes: el BFF anterior deja de funcionar sobre ellos). */
const AFTER_BFF = ["20261010c-payments-purchase-rls.sql", "20261011d-pack-recipe-write-lockdown.sql"];

const bar = `-- ${"=".repeat(77)}`;

function header(title, lines) {
  return [bar, `-- ${title}`, "-- Proyecto: BodegaHub · plan ux-mejoras", "--", ...lines.map((line) => (line ? `-- ${line}` : "--")), bar, ""].join("\n");
}

const COMMON_TAIL = [
  "ARCHIVO GENERADO por scripts/build-deploy-sql.mjs (npm run deploy:sql). NO editarlo a mano: se cambia el parche",
  "en supabase/patches/ (o la lista del script) y se regenera. Los parches van tal cual, uno tras otro, cada uno",
  "precedido de una linea `-- ===== <archivo> =====`.",
];

const FILES = [
  {
    name: "ux-mejoras-01-antes-del-bff.sql",
    patches: BEFORE_BFF,
    header: header("ux-mejoras 01 — parches que van ANTES de desplegar el BFF", [
      `Que es: los ${BEFORE_BFF.length} parches del plan ux-mejoras que se aplican antes del BFF nuevo, concatenados en el`,
      "orden de despliegue (que NO es el alfabetico de sus nombres):",
      ...wrapList(BEFORE_BFF),
      "",
      "Cuando se ejecuta (secuencia completa):",
      "  1. comprobaciones previas de docs/despliegue-ux-mejoras.md, seccion 1 (serie de integridad de stock completa,",
      "     administradores con permisos de venta ya concedidos, ventana sin operacion, app movil, scripts propios,",
      "     compras con paid_ref / paid_ves desalineados). Leerlas ahi: no se repiten aqui.",
      "  2. ESTE ARCHIVO (01).",
      "  3. supabase/patches/verify-patches.sql. Deben quedar en fail TRES filas, y solo esas, las que exigen los dos",
      "     parches del archivo 02:",
      "       - la de la politica de lectura de payments de 20261010c;",
      "       - la de privilegios de 20261011d (escritura directa de las recetas de empaque revocada);",
      "       - la de RLS de product_pack_components de 20261009d (que exige el estado final de 20261011d).",
      "     Cualquier otra fila en fail: parar y revisar antes de desplegar el BFF.",
      "  4. desplegar el BFF.",
      "  5. supabase/patches/deploy/ux-mejoras-02-despues-del-bff.sql.",
      "  6. supabase/patches/verify-patches.sql: ninguna fila en fail.",
      "",
      "Idempotente: cada parche lo es y va en su propia transaccion (begin / commit propios); este archivo se puede",
      "ejecutar otra vez sin romper datos, y el verify queda igual. Si un parche falla, los anteriores ya quedaron",
      "aplicados: corregir la causa y volver a ejecutar el archivo entero.",
      "",
      "Avisos de cada parche (que migra, que bloquea, que cambia a la vista y que hay que reaplicar si se reaplica un",
      "parche anterior): docs/despliegue-ux-mejoras.md, secciones 2 y 3, y la cabecera de cada parche mas abajo.",
      "",
      ...COMMON_TAIL,
    ]),
  },
  {
    name: "ux-mejoras-02-despues-del-bff.sql",
    patches: AFTER_BFF,
    header: header("ux-mejoras 02 — parches que van DESPUES de desplegar el BFF", [
      `Que es: los ${AFTER_BFF.length} parches del plan ux-mejoras que solo se pueden aplicar con el BFF nuevo ya desplegado:`,
      ...wrapList(AFTER_BFF),
      "",
      "NUNCA antes del BFF nuevo: el BFF anterior suma los pagos de una compra con la sesion del usuario (sobre",
      "20261010c, almacen veria \"Pagado 0\") y escribe la receta de empaque por tabla (sobre 20261011d recibiria 403).",
      "",
      "Cuando se ejecuta (secuencia completa):",
      "  1. comprobaciones previas de docs/despliegue-ux-mejoras.md, seccion 1.",
      "  2. supabase/patches/deploy/ux-mejoras-01-antes-del-bff.sql.",
      "  3. supabase/patches/verify-patches.sql: en fail solo las 3 filas que exigen 20261010c y 20261011d.",
      "  4. desplegar el BFF.",
      "  5. ESTE ARCHIVO (02).",
      "  6. supabase/patches/verify-patches.sql: NINGUNA fila en fail.",
      "",
      "Idempotente: cada parche lo es y va en su propia transaccion; se puede ejecutar otra vez y el verify queda igual.",
      "",
      "Deshacer 20261011d (si hubiera que volver al BFF anterior):",
      "  grant insert, update, delete on public.product_pack_conversions, public.product_pack_components to authenticated;",
      "",
      "Detalle: docs/despliegue-ux-mejoras.md, seccion 2 (pasos 25 y 26), y la cabecera de cada parche mas abajo.",
      "",
      ...COMMON_TAIL,
    ]),
  },
];

/** La lista de parches en renglones de comentario de hasta ~110 columnas. */
function wrapList(patches) {
  const lines = [];
  let current = " ";

  for (const patch of patches.map((name) => name.replace(/\.sql$/, ""))) {
    if (current.length + patch.length + 2 > 108) {
      lines.push(current);
      current = " ";
    }
    current += ` ${patch},`;
  }
  lines.push(current.replace(/,$/, ""));

  return lines;
}

function build(file) {
  const parts = [file.header];

  for (const patch of file.patches) {
    const path = resolve(PATCHES_DIR, patch);

    if (!existsSync(path)) {
      throw new Error(`No existe supabase/patches/${patch} (lista de ${file.name}).`);
    }

    const sql = readFileSync(path, "utf8");

    parts.push(`\n-- ===== ${patch} =====\n`, sql, sql.endsWith("\n") ? "" : "\n");
  }

  return parts.join("");
}

function main() {
  const check = process.argv.includes("--check");
  const repeated = [...BEFORE_BFF, ...AFTER_BFF].filter((patch, index, all) => all.indexOf(patch) !== index);

  if (repeated.length > 0) {
    throw new Error(`Parches repetidos en las listas: ${repeated.join(", ")}`);
  }

  const stale = [];

  for (const file of FILES) {
    const target = resolve(DEPLOY_DIR, file.name);
    const content = build(file);

    if (check) {
      if (!existsSync(target) || readFileSync(target, "utf8") !== content) {
        stale.push(file.name);
      }
      continue;
    }

    mkdirSync(DEPLOY_DIR, { recursive: true });
    writeFileSync(target, content);
    console.log(`supabase/patches/deploy/${file.name}: ${file.patches.length} parches, ${content.split("\n").length - 1} lineas`);
  }

  if (stale.length > 0) {
    console.error(
      `Desfasados respecto a supabase/patches/: ${stale.join(", ")}. Corre \`npm run deploy:sql\` y vuelve a probar los dos archivos.`,
    );
    process.exit(1);
  }

  if (check) {
    console.log("supabase/patches/deploy/: al dia");
  }
}

main();
