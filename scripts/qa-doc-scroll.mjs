/**
 * Regresión GQ-01: el documento no debe poder desplazarse.
 *
 * El `<main>` del AppShell es el único contenedor con scroll. Si un descendiente
 * con `position: absolute` (p. ej. un `sr-only`) no encuentra un ancestro
 * posicionado dentro de `<main>`, se coloca respecto al documento, lo alarga y,
 * al seguir bajando al final de una lista, la aplicación entera sale por arriba.
 *
 * Mide en navegador real (un solo Chromium), a 390 y 1280 px, en los listados
 * principales: tras llevar `<main>` al final y girar la rueda,
 * `document.scrollingElement.scrollHeight <= innerHeight` y `scrollY === 0`.
 *
 *   node scripts/qa-doc-scroll.mjs                # contra http://localhost:3000
 *   APP_URL=http://localhost:3207 node scripts/qa-doc-scroll.mjs
 *   SHOTS_DIR=ruta PREFIX=antes node scripts/qa-doc-scroll.mjs   # guarda capturas
 *
 * Requiere la app en modo mock con login demo (`npm run dev:mock`): la sesión
 * se fija con las claves demo de `localStorage`; nunca se usa contra producción.
 * Sale con código 1 si alguna medición falla.
 */
import { mkdirSync } from "node:fs";

import { chromium } from "playwright";

const APP = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SHOTS_DIR = process.env.SHOTS_DIR;
const PREFIX = process.env.PREFIX ?? "doc-scroll";
const ROUTES = (
  process.env.ROUTES ??
  "/products,/sales,/purchases,/inventory,/payments,/contacts,/dashboard"
).split(",");
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
];

if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(APP)) {
  throw new Error(`APP_URL debe ser local (mock): ${APP}`);
}

const browser = await chromium.launch({ headless: true });
const failures = [];
let measured = 0;

try {
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({ viewport, locale: "es-VE" });

    await context.addInitScript(() => {
      try {
        window.localStorage.setItem("bodega-hub:user-role", "admin");
      } catch {
        // Sin almacenamiento no hay sesión demo: la medición fallará por falta de <main>.
      }
    });

    const page = await context.newPage();

    for (const route of ROUTES) {
      await page.goto(APP + route, { waitUntil: "domcontentloaded", timeout: 180_000 });
      await page.locator("main").first().waitFor({ timeout: 120_000 });
      await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
      // Con los datos pintados: sin esqueletos ni spinners y con el alto ya estable.
      const loaded = await page
        .waitForFunction(
          () => {
            const main = document.querySelector("main");

            if (!main || main.querySelector(".animate-pulse, .animate-spin, [aria-busy='true']")) {
              return false;
            }

            const state = (window.__docScroll ??= { height: -1, since: 0 });

            if (state.height !== main.scrollHeight) {
              state.height = main.scrollHeight;
              state.since = Date.now();
              return false;
            }

            return Date.now() - state.since >= 1000;
          },
          undefined,
          { polling: 200, timeout: 90_000 },
        )
        .then(
          () => true,
          () => false,
        );

      // Al final de la lista y, desde ahí, seguir bajando con la rueda real.
      await page.evaluate(() => {
        const main = document.querySelector("main");

        if (main) {
          main.scrollTop = main.scrollHeight;
        }
      });
      await page.mouse.move(viewport.width / 2, viewport.height / 2);

      for (let i = 0; i < 12; i += 1) {
        await page.mouse.wheel(0, 600);
        await page.waitForTimeout(40);
      }

      await page.waitForTimeout(300);

      const result = await page.evaluate(() => {
        const main = document.querySelector("main");
        const scroller = document.scrollingElement ?? document.documentElement;

        return {
          docExtra: scroller.scrollHeight - window.innerHeight,
          mainExtra: main ? main.scrollHeight - main.clientHeight : null,
          mainPosition: main ? window.getComputedStyle(main).position : null,
          mainTop: main ? Math.round(main.getBoundingClientRect().top) : null,
          path: window.location.pathname,
          winY: Math.round(window.scrollY),
        };
      });
      const ok =
        loaded &&
        result.path === route &&
        result.mainExtra !== null &&
        result.docExtra <= 0 &&
        result.winY === 0;

      measured += 1;
      console.log(
        `${ok ? "OK  " : "FAIL"} ${viewport.width} ${route} ${JSON.stringify({ loaded, ...result })}`,
      );

      if (!ok) {
        failures.push(`${viewport.width} ${route}`);
      }

      if (SHOTS_DIR) {
        mkdirSync(SHOTS_DIR, { recursive: true });
        await page.screenshot({
          path: `${SHOTS_DIR}/${PREFIX}-${viewport.width}${route.replaceAll("/", "-")}.jpg`,
          quality: 60,
          type: "jpeg",
        });
      }
    }

    await context.close();
  }
} finally {
  await browser.close();
}

console.log(`\n== ${measured - failures.length}/${measured} OK; FAIL: ${failures.length}`);

if (failures.length > 0) {
  failures.forEach((failure) => console.log(`   FAIL ${failure}`));
  process.exit(1);
}
