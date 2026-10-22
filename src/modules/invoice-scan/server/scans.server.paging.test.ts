/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../lib/supabase/admin-client");

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { createFakePostgrest } from "@/modules/reports/services/testing/fakePostgrest";

import { INVOICE_MAX_LINES } from "../contracts";
import { getDailyUsage, getProductNames } from "./scans.server";

/**
 * REP6-05 (patrón C6-M3): lecturas de invoice-scan que pueden pasar de 1000 filas
 * (PostgREST corta cada respuesta ahí) o de lo que cabe en la URL de un filtro `in`.
 */
const ctx = { storeId: "00000000-0000-4000-8000-000000000001", userId: "44444444-4444-4444-8444-444444444444" };

function uuid(prefix: string, index: number) {
  return `${prefix}-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

describe("scans.server · más de 1000 filas / ids (REP6-05)", () => {
  it("getDailyUsage suma TODOS los escaneos del día aunque pasen de 1000 (límite diario hasta 10.000)", async () => {
    const scans = Array.from({ length: 1500 }, (_, index) => ({
      created_at: new Date(Date.UTC(2026, 9, 14, 12, 0, 0) + index * 1000).toISOString(),
      id: uuid("aaaaaaaa", index),
      store_id: ctx.storeId,
      usage_pages: 1,
    }));
    const fake = createFakePostgrest({ invoice_scans: scans });
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue(fake.client);

    const usage = await getDailyUsage(ctx, 5000, new Date("2026-10-14T20:00:00.000Z"));

    expect(usage).toEqual({ limit: 5000, remaining: 3500, used: 1500 });
  });

  it("getDailyUsage no cuenta dos veces la fila del borde si entra un escaneo entre dos páginas (P8-B1)", async () => {
    // La fila 999 (última de la página 1) vale 3 páginas para que contarla dos veces se note.
    const scans: Array<Record<string, unknown>> = Array.from({ length: 1500 }, (_, index) => ({
      created_at: new Date(Date.UTC(2026, 9, 14, 12, 0, 0) + index * 1000).toISOString(),
      id: uuid("aaaaaaaa", index),
      store_id: ctx.storeId,
      usage_pages: index === 999 ? 3 : 1,
    }));
    const fake = createFakePostgrest({ invoice_scans: scans });
    let ranges = 0;
    // Entre la página 1 y la 2 entra un escaneo cuyo uuid ordena antes que todos:
    // desplaza el corte una fila y la fila 999 vuelve a salir al principio de la página 2.
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
      from: (table: string) => {
        const query = fake.client.from(table);
        const range = query.range.bind(query);

        query.range = (from: number, to: number) => {
          ranges += 1;

          if (ranges === 2) {
            scans.push({
              created_at: new Date(Date.UTC(2026, 9, 14, 18, 0, 0)).toISOString(),
              id: uuid("00000000", 0),
              store_id: ctx.storeId,
              usage_pages: 1,
            });
          }

          return range(from, to);
        };

        return query;
      },
    });

    const usage = await getDailyUsage(ctx, 5000, new Date("2026-10-14T20:00:00.000Z"));
    const finalTotal = scans.reduce((sum, row) => sum + Number(row.usage_pages), 0);

    expect(ranges).toBeGreaterThanOrEqual(2);
    // Lo leído es la foto de antes de la inserción (1502), nunca más que el total real.
    expect(usage.used).toBe(1502);
    expect(usage.used).toBeLessThanOrEqual(finalTotal);
  });

  it("getProductNames resuelve los nombres de una factura con el máximo de líneas sin pasarse del largo de URL", async () => {
    const products = Array.from({ length: INVOICE_MAX_LINES }, (_, index) => ({
      id: uuid("bbbbbbbb", index),
      name: `Producto ${index}`,
      store_id: ctx.storeId,
    }));
    const fake = createFakePostgrest({ products });
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue(fake.client);

    const names = await getProductNames(
      ctx,
      products.map((product) => product.id),
    );

    expect(Object.keys(names)).toHaveLength(INVOICE_MAX_LINES);
    expect(names[uuid("bbbbbbbb", INVOICE_MAX_LINES - 1)]).toBe(`Producto ${INVOICE_MAX_LINES - 1}`);
  });
});
