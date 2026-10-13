/** @jest-environment node */
/**
 * REP-F4 · el reporte "Compras por periodo" da lo mismo en el mock y en el servidor real, y en los dos el total del
 * gráfico (serie) es la suma de la tabla del rango.
 *
 * El mismo conjunto de compras (los cuatro estados, dentro y fuera del rango, con los bordes del día operativo de
 * Caracas) se confirma en la base lab para un proveedor propio y se carga en `mockPurchases`. Después
 * `getPurchasesReport` de `reports.server.ts` lee por PostgREST como el usuario lab `admin` (ACL y RLS reales, sin BFF)
 * y se compara con `reports.mock-server.ts`: mismas filas, mismo `total` y misma serie, por defecto (sin canceladas ni
 * devueltas), con `status=all` y con cada estado. Los datos llevan `TAG` y se borran al terminar.
 *
 *   npm run stock-lab:test -- scripts/stock-lab/regression/report-purchases-parity.test.ts
 *
 * Un fallo de preparación empieza por "SETUP".
 */
import { randomUUID } from "node:crypto";

import { createRouteSupabaseClient } from "../../../src/lib/supabase/route-client";
import { getPurchasesReport as getPurchasesReportMock } from "../../../src/modules/reports/services/reports.mock-server";
import { getPurchasesReport as getPurchasesReportServer } from "../../../src/modules/reports/services/reports.server";
import {
  PURCHASE_REPORT_STATUSES,
  type PurchaseReportStatus,
} from "../../../src/modules/reports/services/reportSeries";
import { mockPurchases } from "../../../src/shared/mocks/erp-data";
import { Lab } from "../scenarios/db";

jest.mock("../../../src/lib/supabase/route-client", () => ({ createRouteSupabaseClient: jest.fn() }));

const TAG = `repf4-${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
const RATE = 50;
const RANGE = "from=2019-03-01&to=2019-03-31";
const EXCLUDED: readonly PurchaseReportStatus[] = ["cancelado", "devuelto"];

type Seed = { createdAt: string; inRange: boolean; status: PurchaseReportStatus; totalRef: number };

/** `inRange`: cae en marzo de 2019 según el día operativo de Caracas (UTC-4). */
const SEEDS: Seed[] = [
  { createdAt: "2019-03-01T04:00:00.000Z", inRange: true, status: "recibido", totalRef: 12.35 },
  { createdAt: "2019-03-05T15:00:00.000Z", inRange: true, status: "recibido", totalRef: 40 },
  { createdAt: "2019-03-05T16:30:00.000Z", inRange: true, status: "pedido", totalRef: 10.1 },
  { createdAt: "2019-03-07T15:00:00.000Z", inRange: true, status: "cancelado", totalRef: 500 },
  { createdAt: "2019-03-09T15:00:00.000Z", inRange: true, status: "devuelto", totalRef: 70.25 },
  // 22:30 del domingo 10 en Caracas (ya es lunes 11 en UTC).
  { createdAt: "2019-03-11T02:30:00.000Z", inRange: true, status: "recibido", totalRef: 7.05 },
  { createdAt: "2019-03-20T15:00:00.000Z", inRange: true, status: "pedido", totalRef: 33.33 },
  // 23:59:59 del 31 de marzo en Caracas: último instante del rango.
  { createdAt: "2019-04-01T03:59:59.000Z", inRange: true, status: "cancelado", totalRef: 21 },
  // 23:59:59 del 28 de febrero en Caracas: fuera, aunque en UTC ya es 1 de marzo.
  { createdAt: "2019-03-01T03:59:59.000Z", inRange: false, status: "recibido", totalRef: 25 },
  { createdAt: "2019-02-15T15:00:00.000Z", inRange: false, status: "devuelto", totalRef: 300 },
  { createdAt: "2019-02-20T15:00:00.000Z", inRange: false, status: "pedido", totalRef: 8.8 },
  // 00:00:00 del 1 de abril en Caracas: fuera.
  { createdAt: "2019-04-01T04:00:00.000Z", inRange: false, status: "recibido", totalRef: 99 },
  { createdAt: "2019-04-10T15:00:00.000Z", inRange: false, status: "cancelado", totalRef: 60 },
];

type Seeded = Seed & { id: string; totalVes: number };

let lab: Lab;
let supplierId = "";
let seeded: Seeded[] = [];
let mockLengthBefore = 0;

const money = (value: number) => Math.round(value * 100) / 100;
const sum = (values: number[]) => money(values.reduce((total, value) => total + value, 0));

function query(extra: string) {
  return new URLSearchParams(`supplierId=${supplierId}&limit=100${extra ? `&${extra}` : ""}`);
}

type Report = Awaited<ReturnType<typeof getPurchasesReportServer>>;

function tableOf(report: Pick<Report, "items">) {
  return report.items
    .map((item) => ({ id: item.id, status: item.status, totalRef: item.totalRef, totalVes: item.totalVes }))
    .sort((first, second) => first.id.localeCompare(second.id));
}

/** Lo que debe salir en la tabla: calculado aparte del servidor y del mock. */
function expectedRows(statuses: readonly PurchaseReportStatus[], onlyInRange: boolean) {
  return seeded
    .filter((row) => statuses.includes(row.status) && (!onlyInRange || row.inRange))
    .map((row) => ({ id: row.id, status: row.status, totalRef: row.totalRef, totalVes: row.totalVes }))
    .sort((first, second) => first.id.localeCompare(second.id));
}

async function both(extra: string) {
  const fromServer = await getPurchasesReportServer(query(extra), lab.storeId);
  const fromMock = getPurchasesReportMock(query(extra), lab.storeId);

  return { fromMock, fromServer };
}

beforeAll(async () => {
  lab = await Lab.open("repf4");

  try {
    const contact = await lab.db.query<{ id: string }>(
      "insert into public.contacts (store_id, name, type) values ($1, $2, 'proveedor') returning id",
      [lab.storeId, `${TAG} proveedor`],
    );
    supplierId = contact.rows[0].id;

    for (const [index, seed] of SEEDS.entries()) {
      const totalVes = money(seed.totalRef * RATE);
      const inserted = await lab.db.query<{ id: string }>(
        `insert into public.purchases (store_id, purchase_number, supplier_id, ref_rate_ves, subtotal_ref, total_ref, total_ves, paid_ves, paid_ref, status, created_at)
         values ($1, $2, $3, $4, $5, $5, $6, 0, 0, $7::public.purchase_status, $8::timestamptz) returning id`,
        [lab.storeId, `${TAG}-oc${index + 1}`, supplierId, RATE, seed.totalRef, totalVes, seed.status, seed.createdAt],
      );
      seeded.push({ ...seed, id: inserted.rows[0].id, totalVes });
    }
  } catch (error) {
    throw new Error(`SETUP · sembrar compras: ${error instanceof Error ? error.message : String(error)}`);
  }

  // El mismo conjunto, en el mock.
  mockLengthBefore = mockPurchases.length;
  mockPurchases.push(
    ...seeded.map((row, index) => ({
      createdAt: row.createdAt,
      discountRef: 0,
      id: row.id,
      paidVes: 0,
      purchaseNumber: `${TAG}-oc${index + 1}`,
      refRateVes: RATE,
      status: row.status,
      storeId: lab.storeId,
      subtotalRef: row.totalRef,
      supplierId,
      taxRef: 0,
      totalRef: row.totalRef,
      totalVes: row.totalVes,
      userId: lab.uids.admin,
    })),
  );

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue(await lab.supa("admin"));
});

afterAll(async () => {
  mockPurchases.length = mockLengthBefore;
  seeded = [];

  if (lab) {
    if (supplierId) {
      await lab.db.query("delete from public.purchases where supplier_id = $1", [supplierId]).catch(() => undefined);
      await lab.db.query("delete from public.contacts where id = $1", [supplierId]).catch(() => undefined);
    }
    await lab.close();
  }
});

describe("REP-F4 · compras por periodo: mock y servidor real cuadran", () => {
  const defaults = PURCHASE_REPORT_STATUSES.filter((status) => !EXCLUDED.includes(status));
  const cases: [string, string, readonly PurchaseReportStatus[]][] = [
    ["por defecto", "", defaults],
    ["status=all", "status=all", PURCHASE_REPORT_STATUSES],
    ...PURCHASE_REPORT_STATUSES.map(
      (status): [string, string, readonly PurchaseReportStatus[]] => [`status=${status}`, `status=${status}`, [status]],
    ),
  ];

  it("el conjunto sembrado tiene los cuatro estados dentro y fuera del rango", () => {
    for (const status of PURCHASE_REPORT_STATUSES) {
      expect(seeded.some((row) => row.status === status && row.inRange)).toBe(true);
      expect(seeded.some((row) => row.status === status && !row.inRange)).toBe(true);
    }
  });

  it.each(cases)("%s: misma tabla, mismo total y misma serie; la serie suma la tabla del rango", async (name, status, statuses) => {
    const { fromMock, fromServer } = await both(`${RANGE}&groupBy=day${status ? `&${status}` : ""}`);
    const expected = expectedRows(statuses, true);
    const totals = {
      count: expected.length,
      totalRef: sum(expected.map((row) => row.totalRef)),
      totalVes: sum(expected.map((row) => row.totalVes)),
    };

    expect(tableOf(fromServer)).toEqual(expected);
    expect(tableOf(fromMock)).toEqual(expected);
    expect([fromServer.total, fromMock.total]).toEqual([expected.length, expected.length]);
    expect(fromServer.series?.totals.current).toEqual(totals);
    expect(fromMock.series?.totals.current).toEqual(totals);
    expect(fromServer.series).toEqual(fromMock.series);
    expect(sum(fromServer.items.map((item) => item.totalRef))).toBe(fromServer.series?.totals.current.totalRef);

    process.stdout.write(
      `REP-F4 ${name}: esperado ${JSON.stringify(totals)} | lab ${JSON.stringify(fromServer.series?.totals.current)} tabla=${fromServer.total} | mock ${JSON.stringify(fromMock.series?.totals.current)} tabla=${fromMock.total}\n`,
    );
  });

  it("por defecto no aparece ninguna cancelada ni devuelta, ni en la tabla ni sumada en la serie", async () => {
    const { fromMock, fromServer } = await both(`${RANGE}&groupBy=day`);
    const withAll = await both(`${RANGE}&groupBy=day&status=all`);
    const excludedRef = sum(seeded.filter((row) => row.inRange && EXCLUDED.includes(row.status)).map((row) => row.totalRef));

    for (const report of [fromServer, fromMock]) {
      expect(report.items.some((item) => (EXCLUDED as readonly string[]).includes(item.status))).toBe(false);
    }
    expect(excludedRef).toBeGreaterThan(0);
    expect(
      money((withAll.fromServer.series?.totals.current.totalRef ?? 0) - (fromServer.series?.totals.current.totalRef ?? 0)),
    ).toBe(excludedRef);
  });

  it.each(["", "status=all", "status=devuelto"])("semana + periodo anterior con «%s»: misma serie y misma comparación", async (status) => {
    const { fromMock, fromServer } = await both(`${RANGE}&groupBy=week&compare=1${status ? `&${status}` : ""}`);

    expect(fromServer.series?.previous).not.toBeNull();
    expect(fromServer.series).toEqual(fromMock.series);
  });

  it.each(cases)("sin rango, %s: misma tabla y mismo total paginado", async (_name, status, statuses) => {
    const { fromMock, fromServer } = await both(status);
    const expected = expectedRows(statuses, false);

    expect(tableOf(fromServer)).toEqual(expected);
    expect(tableOf(fromMock)).toEqual(expected);
    expect([fromServer.total, fromMock.total]).toEqual([expected.length, expected.length]);
    expect(fromServer).not.toHaveProperty("series");
  });

  it("un estado desconocido es un 400 en los dos, sin llegar a la base", async () => {
    const bad = query("status=anulado");

    await expect(getPurchasesReportServer(bad, lab.storeId)).rejects.toMatchObject({ status: 400 });
    expect(() => getPurchasesReportMock(bad, lab.storeId)).toThrow(/estado de compra no es válido/);
  });

  it("pedido para otra tienda no devuelve estas compras, con cualquier `status`", async () => {
    const result = await getPurchasesReportServer(query("status=all"), lab.defaultStoreId);

    expect(result.total).toBe(0);
  });
});
