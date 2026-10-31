/**
 * REP17-03 · D70(b): escenarios del test de propiedad que mide TODO el panel de revisión (cabecera, filas, contenido
 * tras las filas y pie), sobre el arnés de REP16-02 (`InvoiceReviewPanel.rep16-02.harness.tsx`, alcance «panel»).
 *
 * - «tasa escrita y luego llega la del día» (M-p18B-1): sin tasa del día ni impresa, el usuario escribe 950 en la
 *   cabecera y vuelve al campo; llega la del día (900). Ningún control del panel se mueve, el campo sigue con 950 y los
 *   costos siguen convertidos con ella («Tasa de hoy» no queda elegida sola).
 * - «duplicado tardío» (B-p18B-1): el aviso de posible duplicado llega después del primer render, con la página arriba o
 *   al final (pie fijo en su sitio natural; con alto < 500 px, pie no fijo). Ningún control del panel se mueve.
 * - «no se suelta tras arrastre corto» (B-p18B-2): la tasa del día llega sin desviar L1 y su reserva queda retenida como
 *   hueco con el dedo en «Descartar línea» de L2; el dedo arrastra 24 px. Lo que está bajo el último punto de contacto
 *   sigue ahí: el control se movió lo que movió el dedo. REP17-18 (D72(a)): el arrastre ya no suelta nada; ningún control
 *   del panel cambia de posición en el documento y lo retenido sigue retenido.
 */
import { expect, within } from "storybook/test";

import { clickElement, pressKeys, settleCdpAcks } from "./InvoiceReviewPanel.cdpInput";
import { type Fixture, FIXTURES } from "./InvoiceReviewPanel.rep16-02.fixtures";
import {
  arrive,
  buttonIn,
  measureArrival,
  openViewport,
  panelRoot,
  row,
  scroller,
  settle,
  type VIEWPORTS,
  withCase,
} from "./InvoiceReviewPanel.rep16-02.harness";
import { heldNow, isHolding, releasedBetween, trackPanel } from "./InvoiceReviewPanel.rep17-18.harness";

type Browser = NonNullable<Awaited<ReturnType<typeof openViewport>>>["browser"];

function panel() {
  const root = panelRoot();
  if (!root) {
    throw new Error("Sin panel");
  }
  return root;
}

const RATE_LABEL = "Tasa Bs por REF";
const TYPED_RATE = 950;

function rateInput() {
  return within(panel()).queryByLabelText<HTMLInputElement>(RATE_LABEL);
}

/** La opción «Tasa de hoy (…)» del aviso de tasa, si la hay. */
function todayChoice() {
  return [...panel().querySelectorAll<HTMLElement>('[role="radio"]')].find((item) => /Tasa de hoy/.test(item.textContent ?? "")) ?? null;
}

/** Costo por unidad que muestra la fila («4,74 REF/u»). */
function unitCostOf(element: HTMLElement) {
  return /[\d.]+,\d{2} REF\/u/.exec(element.textContent ?? "")?.[0] ?? null;
}

/** Valor del campo de la tasa escrita (950 no lleva separador de miles: la coma, si la hay, es la decimal). */
function typedValue(input: HTMLInputElement) {
  return Number(input.value.replace(",", "."));
}

/** Fila con 4.500 Bs y último costo 0,50 REF en cada factura (su costo dice con qué tasa se convierte). */
const HARINA_ROW: Record<"tasa3" | "estados", number> = { estados: 4, tasa3: 1 };

/** Escenario 1: tasa escrita a mano y luego llega la del día. */
async function typedRateThenSystem(browser: Browser, fixtureId: "tasa3" | "estados"): Promise<string[]> {
  return withCase(FIXTURES[fixtureId], async () => {
    const input = rateInput();
    if (!input) {
      throw new Error(`${fixtureId}: sin tasa del día ni impresa no se pide escribir la tasa («${RATE_LABEL}»)`);
    }
    await clickElement(browser, input);
    await pressKeys(browser, `${TYPED_RATE}{Tab}`);
    await settle("escribir la tasa", () => /se usa la tasa escrita \(Bs\. 950,00\)/.test(panel().textContent ?? ""));
    // El usuario vuelve al campo para corregirla (sin desplazar: el campo está a la vista tras escribir).
    rateInput()?.focus({ preventScroll: true });
    await settle("volver al campo");
    const harina = row(HARINA_ROW[fixtureId]);
    const costBefore = unitCostOf(harina);
    if (costBefore !== "4,74 REF/u") {
      throw new Error(`${fixtureId}: con la tasa escrita (950) L${HARINA_ROW[fixtureId]} debía costar 4,74 REF/u y dice ${costBefore}`);
    }
    const failures: string[] = [];
    const moved = await measureArrival({ outcome: "ok", source: "rate" }, "panel", () => todayChoice() !== null);
    if (moved) {
      failures.push(moved);
    }
    const after = rateInput();
    if (!after || Math.abs(typedValue(after) - TYPED_RATE) > 0.001) {
      failures.push(`la tasa escrita se sustituyó sola: el campo «${RATE_LABEL}» ${after ? `dice «${after.value}»` : "ya no está"}`);
    }
    if (todayChoice()?.getAttribute("aria-checked") === "true") {
      failures.push("«Tasa de hoy» quedó elegida sin que el usuario la eligiera");
    }
    const costAfter = unitCostOf(row(HARINA_ROW[fixtureId]));
    if (costAfter !== costBefore) {
      failures.push(`los costos dejaron de usar la tasa escrita: L${HARINA_ROW[fixtureId]} pasó de ${costBefore} a ${costAfter}`);
    }
    return failures.map((failure) => `tasa escrita y luego la del día · ${fixtureId} · ${failure}`);
  });
}

type DuplicateVariant = { id: string; before: "nada" | "proveedor y tasa"; page: "arriba" | "final" };

const DUPLICATE_VARIANTS: DuplicateVariant[] = [
  { before: "proveedor y tasa", id: "arriba", page: "arriba" },
  { before: "proveedor y tasa", id: "final", page: "final" },
  { before: "nada", id: "final-sin-tasa", page: "final" },
];

/** Escenario 2: el aviso de posible duplicado llega tarde (factura sin duplicado del escaneo: `tasa3`). */
async function lateDuplicate(variant: DuplicateVariant): Promise<string[]> {
  return withCase(FIXTURES.tasa3, async () => {
    if (variant.before === "proveedor y tasa") {
      await arrive({ outcome: "ok", source: "supplier" });
      await arrive({ outcome: "ok", source: "rate" });
    }
    if (variant.page === "final") {
      const main = scroller();
      main.scrollTop = main.scrollHeight;
      await settle("al final");
    }
    const moved = await measureArrival({ outcome: "match", source: "duplicates" }, "panel");
    if (!/No es la misma compra/.test(panel().textContent ?? "")) {
      throw new Error(`duplicado tardío · ${variant.id}: no apareció el aviso de posible duplicado`);
    }
    return moved ? [`duplicado tardío · ${variant.id} · ${moved}`] : [];
  });
}

/** La tasa del día que no desvía L1 (4.500 Bs a 9.000 = 0,50 REF, su último costo): su reserva sobra (B-p18B-2). */
const TASA3_ALIGNED: Fixture = { ...FIXTURES.tasa3, systemRateVes: 9000 };

const DRAG_PX = 24;
const DRAG_STEPS = 4;
const TOUCH_ID = 7;

const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));

function touchEvent(type: "touchstart" | "touchmove" | "touchend", target: Element, clientX: number, clientY: number) {
  const touch = new Touch({ clientX, clientY, identifier: TOUCH_ID, target });
  const touches = type === "touchend" ? [] : [touch];
  target.dispatchEvent(
    new TouchEvent(type, { bubbles: true, cancelable: true, changedTouches: [touch], composed: true, targetTouches: touches, touches }),
  );
}

function pointerEvent(type: "pointerdown" | "pointermove" | "pointercancel", target: Element, clientX: number, clientY: number) {
  target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, cancelable: true, clientX, clientY, composed: true, isPrimary: true, pointerId: TOUCH_ID, pointerType: "touch" }),
  );
}

function describeElement(element: Element | null) {
  if (!element) {
    return "nada";
  }
  const control = element.closest("button, a[href], input, label, [role]") ?? element;
  const text = control.getAttribute("aria-label") || control.textContent?.replace(/\s+/g, " ").trim() || "";
  return `${control.tagName.toLowerCase()}«${text.slice(0, 32)}»`;
}

/** Escenario 3: retención activa (hueco de la reserva de L1) y un arrastre corto con el dedo en «Descartar» de L2. */
async function shortDragKeeps(): Promise<string[]> {
  return withCase(TASA3_ALIGNED, async () => {
    // Página arriba, como en B-p18B-2; si L2 no se ve (844×390), lo justo para verla.
    const target = buttonIn(row(2), /Descartar línea/);
    target.scrollIntoView({ block: "nearest" });
    // REP17-02: `nearest` lo deja en el borde de abajo, tapado por el pie fijo salvo una franja; lo justo para verlo
    // entero encima del pie (si no, al arrastrar el contenido pasa bajo el pie y el último punto de contacto cae en él).
    const footer = panel().querySelector('[data-layout-box="footer"]');
    const covered = footer ? target.getBoundingClientRect().bottom - footer.getBoundingClientRect().top : 0;
    if (covered > 0) {
      scroller().scrollTop += Math.ceil(covered) + 8;
    }
    await settle("L2 a la vista");
    const box = target.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    if (!target.contains(document.elementFromPoint(x, y))) {
      throw new Error(`«Descartar línea» de L2 no está bajo el dedo: hay ${describeElement(document.elementFromPoint(x, y))}`);
    }
    // Dedo en «Descartar línea» de L2 (sin levantarlo: no hay clic).
    pointerEvent("pointerdown", target, x, y);
    touchEvent("touchstart", target, x, y);
    await settle("dedo en Descartar");
    const failures: string[] = [];
    const moved = await measureArrival({ outcome: "ok", source: "rate" }, "panel");
    if (moved) {
      failures.push(moved);
    }
    const main = scroller();
    // El dedo sube y el contenido con él.
    if (main.scrollHeight - main.clientHeight - main.scrollTop < DRAG_PX) {
      throw new Error(`sin sitio para desplazar ${DRAG_PX} px`);
    }
    const held = heldNow();
    if (!isHolding(held)) {
      throw new Error("tras llegar la tasa del día sin desviar L1 no queda nada retenido");
    }
    const tracker = trackPanel();
    const before = target.getBoundingClientRect().top;
    let fingerY = y;
    for (let step = 1; step <= DRAG_STEPS; step += 1) {
      fingerY -= DRAG_PX / DRAG_STEPS;
      touchEvent("touchmove", target, x, fingerY);
      if (step === 1) {
        // El navegador toma el gesto como desplazamiento: cancela el puntero.
        pointerEvent("pointercancel", target, x, fingerY);
      }
      main.scrollTop += DRAG_PX / DRAG_STEPS;
      await frame();
      tracker.sample();
    }
    touchEvent("touchend", target, x, fingerY);
    await settle("arrastre corto", () => true, tracker.sample);
    const expected = before - DRAG_PX;
    const after = target.isConnected ? target.getBoundingClientRect().top : Number.NaN;
    const under = document.elementFromPoint(x, fingerY);
    if (!(Math.abs(after - expected) <= 1) || !(under && target.contains(under))) {
      failures.push(
        `tras un arrastre de ${DRAG_PX} px «Descartar línea» de L2 pasó de y=${Math.round(before)} a y=${Math.round(after)} (el dedo lo dejaba en y=${Math.round(expected)}); bajo el último punto de contacto queda ${describeElement(under)}`,
      );
    }
    failures.push(...[tracker.report(), releasedBetween(held, heldNow())].filter((failure) => failure !== null));
    return failures.map((failure) => `no se suelta tras arrastre corto · tasa3 a 9000 · ${failure}`);
  });
}

export type Scenario = "tasaEscrita" | "duplicadoTardio" | "noSueltaArrastre";

const SCENARIOS: Record<Scenario, (browser: Browser) => Promise<string[][]>> = {
  duplicadoTardio: async () => {
    const results: string[][] = [];
    for (const variant of DUPLICATE_VARIANTS) {
      results.push(await lateDuplicate(variant));
    }
    return results;
  },
  noSueltaArrastre: async () => [await shortDragKeeps()],
  tasaEscrita: async (browser) => [await typedRateThenSystem(browser, "tasa3"), await typedRateThenSystem(browser, "estados")],
};

/** `play` de una historia: el escenario a ese ancho; falla con lo que se movió o se sustituyó solo. */
export function scenarioPlay(scenario: Scenario, viewport: keyof typeof VIEWPORTS) {
  return async () => {
    const opened = await openViewport(viewport);
    if (!opened) {
      return;
    }
    const results = await SCENARIOS[scenario](opened.browser);
    await settleCdpAcks();
    const failures = results.flat().map((failure) => `${opened.label} ${failure}`);
    failures.forEach((failure) => console.warn(`[REP17-03 rojo] ${failure}`));
    const text = `${opened.label} ${scenario}: ${results.length} casos, ${results.filter((result) => result.length > 0).length} en rojo`;
    console.warn(`[REP17-03] ${text}`);
    await expect(failures, text).toEqual([]);
  };
}
