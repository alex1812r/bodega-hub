/**
 * Regresión GQ-03: ningún rol debe recibir 403 «de ruido» al navegar por SUS
 * pantallas (una pantalla que pide un endpoint que su rol no puede leer).
 *
 * Como vendedor, almacén y contador: abre cada enlace del menú lateral y, en
 * cada listado, el primer detalle enlazado con todas sus pestañas. Falla si
 * alguna respuesta de `/api/*` es 401/403 o 5xx.
 *
 *   node scripts/qa-role-403.mjs                 # contra http://localhost:3000
 *   APP_URL=http://localhost:3207 ROLES=vendedor node scripts/qa-role-403.mjs
 *
 * Requiere la app en modo mock con login demo (`npm run dev:mock`): el rol se
 * fija con las claves demo de `localStorage`; nunca se usa contra producción.
 * Sale con código 1 si hay alguna respuesta de ruido.
 */
import { chromium } from "playwright";

const APP = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const ROLES = (process.env.ROLES ?? "vendedor,almacen,contador").split(",");
const DETAIL_HREF = /^\/(sales|purchases|products|contacts|payments|cash|inventory)\/(?!create|import|movements|categories)[^/?#]+/;

if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(APP)) {
  throw new Error(`APP_URL debe ser local (mock): ${APP}`);
}

const browser = await chromium.launch({ headless: true });
const noise = [];
let visited = 0;

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
  // Con los datos pintados: sin esqueletos ni spinners y con el alto ya estable.
  await page
    .waitForFunction(
      () => {
        const main = document.querySelector("main");

        if (!main || main.querySelector(".animate-pulse, .animate-spin, [aria-busy='true']")) {
          return false;
        }

        const state = (window.__settle ??= { height: -1, since: 0 });

        if (state.height !== main.scrollHeight) {
          state.height = main.scrollHeight;
          state.since = Date.now();
          return false;
        }

        return Date.now() - state.since >= 800;
      },
      undefined,
      { polling: 200, timeout: 30_000 },
    )
    .catch(() => {});
}

try {
  for (const role of ROLES) {
    const context = await browser.newContext({
      locale: "es-VE",
      viewport: { width: 1280, height: 800 },
    });

    await context.addInitScript((demoRole) => {
      try {
        window.localStorage.setItem("bodega-hub:user-role", demoRole);
      } catch {
        // Sin almacenamiento no hay sesión demo.
      }
    }, role);

    const page = await context.newPage();
    let current = "";
    const details = [];

    page.on("response", (response) => {
      const url = new URL(response.url());
      const status = response.status();

      if (url.pathname.startsWith("/api/") && (status === 401 || status === 403 || status >= 500)) {
        noise.push(`${role} ${current} -> ${status} ${response.request().method()} ${url.pathname}`);
      }
    });

    async function visit(path) {
      current = path;
      visited += 1;
      // `next dev` compila cada ruta la primera vez y a veces deja la carga a medias:
      // un segundo intento de navegación; si tampoco pinta `<main>`, el guion falla.
      for (let attempt = 1; ; attempt += 1) {
        try {
          await page.goto(APP + path, { waitUntil: "domcontentloaded", timeout: 120_000 });
          await page.locator("main").first().waitFor({ timeout: 60_000 });
          break;
        } catch (error) {
          if (attempt === 2) {
            throw error;
          }

          console.log(`    · ${role} ${path}: no cargó a la primera, se reintenta`);
        }
      }

      await settle(page);
    }

    await visit("/dashboard");

    const menu = await page
      .locator("aside a[href^='/'], nav a[href^='/']")
      .evaluateAll((links) => [...new Set(links.map((link) => link.getAttribute("href")))]);

    for (const path of menu) {
      await visit(path);

      const hrefs = await page
        .locator("main a[href^='/']")
        .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
      const detail = hrefs.find((href) => DETAIL_HREF.test(href));

      if (!detail) {
        continue;
      }

      details.push(detail.split("?")[0]);
      await visit(detail);

      const tabs = page.locator("main [role='tab']");

      for (let index = 0; index < (await tabs.count()); index += 1) {
        await tabs.nth(index).click();
        await settle(page);
      }
    }

    console.log(
      `${role}: ${menu.length} pantallas del menú (${menu.join(" ")}); detalles: ${details.join(" ") || "ninguno"}`,
    );
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(`\n== ${visited} pantallas visitadas; respuestas de ruido: ${noise.length}`);

if (noise.length > 0) {
  [...new Set(noise)].forEach((line) => console.log(`   FAIL ${line}`));
  process.exit(1);
}
