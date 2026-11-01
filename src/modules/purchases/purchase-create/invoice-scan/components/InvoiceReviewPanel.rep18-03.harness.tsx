/**
 * REP18-03 · D75(d) (B-p19B-1): con la página al final, la tasa del día con cifras imprevistas (1, 12.345,67) no mueve
 * ningún control del panel (pie incluido) ni recorta el desplazamiento; tampoco con las normales (250, 900, 1500).
 *
 * Sobre el arnés de REP16-02 (`InvoiceReviewPanel.rep16-02.harness.tsx`): fixture `tasa3` (la del caos) y la misma con
 * los importes de las líneas por mil (cifras largas: con tasa 1 el motivo del desvío dice «4.500.000,00 REF»), con la tasa
 * del día del caso; llegan antes el proveedor y los duplicados (vacíos), la página se lleva al final y se suelta la tasa.
 * Falla si algún control del panel cambia su `top` en algún frame hasta quedar quieto, si el contenedor cambia su
 * desplazamiento sin entrada del usuario, o si «Compactar lista» no tiene su hueco tras las filas desde el primer render.
 */
import { expect } from "storybook/test";

import { type Fixture, FIXTURES } from "./InvoiceReviewPanel.rep16-02.fixtures";
import {
  arrive,
  measureArrival,
  openViewport,
  panelRoot,
  scroller,
  settle,
  type VIEWPORTS,
  withCase,
} from "./InvoiceReviewPanel.rep16-02.harness";

/** Las tasas del reporte (Bs por REF): las normales y las que la reserva no preveía. */
export const END_RATES = [1, 250, 900, 1500, 12345.67] as const;

/** `tasa3` con los importes de sus líneas multiplicados por `factor` (el último costo, 0,50 REF, no cambia). */
function scaled(fixture: Fixture, factor: number): Fixture {
  const { extraction, matched } = fixture.response;
  const times = (value: number) => value * factor;
  const timesIfAny = (value: number | undefined) => (value === undefined ? undefined : value * factor);
  return {
    ...fixture,
    response: {
      ...fixture.response,
      extraction: {
        ...extraction,
        lines: extraction.lines.map((line) => ({ ...line, lineTotal: times(line.lineTotal), unitPrice: times(line.unitPrice) })),
        subtotal: timesIfAny(extraction.subtotal),
        total: timesIfAny(extraction.total),
      },
      matched: {
        ...matched,
        lines: matched.lines.map((line) => ({ ...line, unitCostRef: timesIfAny(line.unitCostRef), unitCostVes: timesIfAny(line.unitCostVes) })),
        totals: { ...matched.totals, computed: times(matched.totals.computed), read: timesIfAny(matched.totals.read) },
      },
    },
  };
}

/** Las facturas: la del caos y la de cifras largas. */
const END_FIXTURES = [
  { fixture: FIXTURES.tasa3, label: "tasa3" },
  { fixture: scaled(FIXTURES.tasa3, 1000), label: "tasa3 ×1000" },
  { fixture: scaled(FIXTURES.tasa3, 1_000_000), label: "tasa3 ×1.000.000" },
] as const;

/** Alto del hueco de «Compactar lista» tras las filas (36 px, `h-9`), ocupado o no desde el primer render. */
const COMPACT_SLOT_PX = 36;

function compactSlot() {
  return panelRoot()?.querySelector<HTMLElement>('[data-testid="invoice-review-compact-slot"]') ?? null;
}

/** La tasa `rate` llega con la página al final: qué se movió o recortó (vacío = cumple). */
async function endCase(base: (typeof END_FIXTURES)[number], rate: number): Promise<string[]> {
  return withCase({ ...base.fixture, systemRateVes: rate }, async () => {
    const failures: string[] = [];
    const slot = compactSlot();
    const slotHeight = slot ? Math.round(slot.getBoundingClientRect().height) : null;
    if (slotHeight !== COMPACT_SLOT_PX) {
      failures.push(`el hueco de «Compactar lista» mide ${slotHeight ?? "nada"} px en el primer render (no ${COMPACT_SLOT_PX})`);
    }
    await arrive({ outcome: "ok", source: "supplier" });
    await arrive({ outcome: "none", source: "duplicates" });
    const main = scroller();
    main.scrollTop = main.scrollHeight;
    await settle("página al final");
    const top = main.scrollTop;
    const moved = await measureArrival({ outcome: "ok", source: "rate" }, "panel");
    if (moved) {
      failures.push(moved);
    }
    if (Math.abs(main.scrollTop - top) >= 1) {
      failures.push(`el desplazamiento pasó de ${Math.round(top)} a ${Math.round(main.scrollTop)} sin entrada del usuario`);
    }
    return failures.map((failure) => `${base.label} tasa ${rate} al final · ${failure}`);
  });
}

/** `play` de una historia: las cinco tasas con cada factura a ese ancho; falla con lo que se movió. */
export function endPlay(viewport: keyof typeof VIEWPORTS) {
  return async () => {
    const opened = await openViewport(viewport);
    if (!opened) {
      return;
    }
    const failures: string[] = [];
    for (const base of END_FIXTURES) {
      for (const rate of END_RATES) {
        failures.push(...(await endCase(base, rate)).map((failure) => `${opened.label} ${failure}`));
      }
    }
    failures.forEach((failure) => console.warn(`[REP18-03 rojo] ${failure}`));
    const text = `${opened.label}: ${END_FIXTURES.length} facturas × ${END_RATES.length} tasas al final, ${failures.length} fallos`;
    console.warn(`[REP18-03] ${text}`);
    await expect(failures, text).toEqual([]);
  };
}
