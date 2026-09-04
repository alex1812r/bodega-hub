/**
 * @jest-environment node
 */

import { SECOND_MOCK_STORE_ID } from "@/modules/platform/services/stores.mock-server";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { listToolDefinitions, toolNamesForScope, toolsForContext } from "./index";

import type { AssistantToolContext, AssistantToolResult } from "../../types";

const TODAY = "2026-05-18";

function storeContext(storeIds: string[] = [DEFAULT_STORE_ID]): AssistantToolContext {
  return {
    dataSource: "mock",
    role: "admin",
    scope: "store",
    storeIds,
    storeName: "BodegaHub",
    today: TODAY,
    userId: "user-admin",
  };
}

function platformContext(): AssistantToolContext {
  return {
    dataSource: "mock",
    role: "superadmin",
    scope: "platform",
    storeIds: [DEFAULT_STORE_ID, SECOND_MOCK_STORE_ID],
    storeName: null,
    today: TODAY,
    userId: "user-superadmin",
  };
}

function run(name: string, input: unknown, ctx: AssistantToolContext) {
  const definition = listToolDefinitions().find((entry) => entry.name === name)!;

  return definition.execute(input as never, ctx) as Promise<AssistantToolResult<never>>;
}

function expectOk<T>(result: AssistantToolResult<T>) {
  if (!result.ok) {
    throw new Error(`Se esperaba ok:true, llego: ${result.error}`);
  }

  return result;
}

describe("assistant tool registry", () => {
  it("registers the ten store tools and the two platform tools", () => {
    expect(toolNamesForScope("store").sort()).toEqual([
      "capital_actual",
      "cierre_dia",
      "compras_periodo",
      "ganancia_bruta",
      "metodos_pago",
      "rentabilidad_productos",
      "stock_bajo",
      "top_clientes",
      "top_productos",
      "ventas_periodo",
    ]);
    expect(toolNamesForScope("platform").sort()).toEqual([
      "comparar_tiendas",
      "listar_tiendas",
    ]);
  });

  it("never mixes store and platform tools in the same context", () => {
    const storeTools = Object.keys(toolsForContext(storeContext()));
    const platformTools = Object.keys(toolsForContext(platformContext()));

    expect(storeTools).toContain("ventas_periodo");
    expect(storeTools).not.toContain("comparar_tiendas");
    expect(storeTools).not.toContain("listar_tiendas");

    expect(platformTools).toEqual(expect.arrayContaining(["comparar_tiendas", "listar_tiendas"]));
    expect(platformTools).not.toContain("ventas_periodo");
    expect(platformTools).not.toContain("capital_actual");
  });

  it("turns a thrown tool error into ok:false instead of crashing", async () => {
    const tools = toolsForContext(storeContext());
    const result = (await tools.ganancia_bruta!.execute!(
      { from: "2026-02-30" } as never,
      { messages: [], toolCallId: "t1" } as never,
    )) as AssistantToolResult<unknown>;

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ error: expect.stringContaining("2026-02-30") });
  });

  it("describes every tool with example questions", () => {
    for (const definition of listToolDefinitions()) {
      expect(definition.description.length).toBeGreaterThan(30);
      expect(definition.examples.length).toBeGreaterThan(0);
    }
  });
});

describe("store tools", () => {
  it("ventas_periodo totals the range and can compare", async () => {
    const result = expectOk(
      await run("ventas_periodo", { from: "2026-05-17", to: "2026-05-18" }, storeContext()),
    );

    expect(result.range).toEqual({ from: "2026-05-17", to: "2026-05-18" });
    expect(result.data).toMatchObject({
      actual: { salesCount: 3, totalRef: 77.5, unitsSold: 11 },
    });

    const compared = expectOk(
      await run(
        "ventas_periodo",
        { compararConPeriodoAnterior: true, from: "2026-05-18", to: "2026-05-18" },
        storeContext(),
      ),
    );

    expect(compared.data).toMatchObject({ anterior: { rango: { from: "2026-05-17", to: "2026-05-17" } } });
  });

  it("ganancia_bruta groups by month when asked", async () => {
    const result = expectOk(
      await run(
        "ganancia_bruta",
        { agruparPor: "mes", from: "2026-05-01", to: "2026-05-31" },
        storeContext(),
      ),
    );

    expect(result.data).toMatchObject({ agrupadoPor: "mes" });
    expect((result.data as { serie: unknown[] }).serie).toEqual([
      expect.objectContaining({ periodo: "2026-05" }),
    ]);
  });

  it("top_productos ranks with product names and honours the limit", async () => {
    const result = expectOk(
      await run("top_productos", { from: "2026-05-01", limit: 2, to: "2026-05-31" }, storeContext()),
    );
    const ranking = (result.data as { ranking: Array<{ nombre: string }> }).ranking;

    expect(ranking).toHaveLength(2);
    expect(ranking[0]!.nombre).not.toMatch(/^[a-z]{3}-/);
  });

  it("top_clientes ranks customers by amount", async () => {
    const result = expectOk(
      await run("top_clientes", { from: "2026-05-01", to: "2026-05-31" }, storeContext()),
    );

    expect((result.data as { ranking: unknown[] }).ranking.length).toBeGreaterThan(0);
  });

  it("rentabilidad_productos can invert the order", async () => {
    const best = expectOk(await run("rentabilidad_productos", { limit: 3 }, storeContext()));
    const worst = expectOk(
      await run("rentabilidad_productos", { limit: 3, orden: "menor" }, storeContext()),
    );

    const bestFirst = (best.data as { productos: Array<{ gananciaRef: number }> }).productos[0]!;
    const worstFirst = (worst.data as { productos: Array<{ gananciaRef: number }> }).productos[0]!;

    expect(bestFirst.gananciaRef).toBeGreaterThanOrEqual(worstFirst.gananciaRef);
  });

  it("compras_periodo summarises and can break down by supplier", async () => {
    const result = expectOk(
      await run("compras_periodo", { from: "2026-01-01", to: "2026-12-31" }, storeContext()),
    );

    expect(result.data).toMatchObject({ resumen: { compras: expect.any(Number) } });

    const bySupplier = expectOk(
      await run(
        "compras_periodo",
        { from: "2026-01-01", porProveedor: true, to: "2026-12-31" },
        storeContext(),
      ),
    );

    expect(bySupplier.data).toMatchObject({ porProveedor: expect.any(Array) });
  });

  it("stock_bajo lists products under the minimum", async () => {
    const result = expectOk(await run("stock_bajo", {}, storeContext()));
    const data = result.data as { productos: Array<{ nombre: string }>; total: number };

    expect(data.total).toBeGreaterThan(0);
    expect(data.productos[0]!.nombre).toBeTruthy();
  });

  it("cierre_dia returns sales, payments and vault snapshots", async () => {
    const result = expectOk(await run("cierre_dia", { fecha: "2026-05-18" }, storeContext()));

    expect(result.range).toEqual({ from: "2026-05-18", to: "2026-05-18" });
    expect(result.data).toMatchObject({ ventas: { cantidad: expect.any(Number) } });
    expect(result.note).toContain("cierres de caja");
  });

  it("metodos_pago splits the payment mix", async () => {
    const result = expectOk(
      await run("metodos_pago", { from: "2026-05-01", to: "2026-05-31" }, storeContext()),
    );

    expect(result.data).toMatchObject({ totalPagos: expect.any(Number) });
  });

  it("capital_actual breaks the capital into components", async () => {
    const result = expectOk(await run("capital_actual", {}, storeContext()));
    const data = result.data as {
      capitalRef: number;
      componentes: Record<string, number>;
    };

    expect(data.componentes.inventarioACostoRef).toBeGreaterThan(0);
    expect(data.capitalRef).toBeCloseTo(
      data.componentes.baulRef! +
        data.componentes.baulTotalBsEnRef! +
        data.componentes.inventarioACostoRef! +
        data.componentes.cuentasPorCobrarRef! -
        data.componentes.cuentasPorPagarRef!,
      2,
    );
  });

  it("caps every list at twenty rows", async () => {
    const result = expectOk(
      await run("top_productos", { from: "2026-01-01", limit: 20, to: "2026-12-31" }, storeContext()),
    );

    expect((result.data as { ranking: unknown[] }).ranking.length).toBeLessThanOrEqual(20);
  });
});

describe("store isolation", () => {
  it("returns different data for another store", async () => {
    const own = expectOk(
      await run("ventas_periodo", { from: "2026-05-01", to: "2026-05-31" }, storeContext()),
    );
    const other = expectOk(
      await run(
        "ventas_periodo",
        { from: "2026-05-01", to: "2026-05-31" },
        storeContext([SECOND_MOCK_STORE_ID]),
      ),
    );

    expect(other.data).not.toEqual(own.data);
    expect((other.data as { actual: { totalRef: number } }).actual.totalRef).toBe(51);
  });

  it("returns nothing for a store id that does not exist", async () => {
    const result = expectOk(
      await run(
        "ventas_periodo",
        { from: "2026-05-01", to: "2026-05-31" },
        storeContext(["store-inexistente"]),
      ),
    );

    expect(result.data).toMatchObject({ actual: { salesCount: 0, totalRef: 0 } });
  });

  it("keeps product rankings inside the store", async () => {
    const other = expectOk(
      await run(
        "top_productos",
        { from: "2026-05-01", to: "2026-05-31" },
        storeContext([SECOND_MOCK_STORE_ID]),
      ),
    );
    const names = (other.data as { ranking: Array<{ nombre: string }> }).ranking.map(
      (row) => row.nombre,
    );

    expect(names).toContain("Arroz blanco 1kg");
    expect(names).not.toContain("Taladro percutor");
  });
});

describe("platform tools", () => {
  it("listar_tiendas returns every store", async () => {
    const result = expectOk(await run("listar_tiendas", {}, platformContext()));
    const data = result.data as { activas: number; tiendas: Array<{ nombre: string }> };

    expect(data.tiendas.map((store) => store.nombre)).toEqual(
      expect.arrayContaining(["BodegaHub", "Bodega Sur"]),
    );
    expect(data.activas).toBeGreaterThanOrEqual(2);
  });

  it("comparar_tiendas ranks all active stores", async () => {
    const result = expectOk(
      await run(
        "comparar_tiendas",
        { from: "2026-05-01", metrica: "ventas", to: "2026-05-31" },
        platformContext(),
      ),
    );
    const ranking = (result.data as { ranking: Array<{ tienda: string; ventasRef: number }> })
      .ranking;

    expect(ranking).toHaveLength(2);
    expect(ranking[0]!.ventasRef).toBeGreaterThanOrEqual(ranking[1]!.ventasRef);
  });

  it("comparar_tiendas resolves store names without accents or case", async () => {
    const result = expectOk(
      await run(
        "comparar_tiendas",
        { from: "2026-05-01", tiendas: ["BODEGA SUR"], to: "2026-05-31" },
        platformContext(),
      ),
    );

    expect((result.data as { ranking: Array<{ tienda: string }> }).ranking).toEqual([
      expect.objectContaining({ tienda: "Bodega Sur" }),
    ]);
  });

  it("comparar_tiendas lists the options when the store does not exist", async () => {
    const result = await run(
      "comparar_tiendas",
      { tiendas: ["Bodega Marte"] },
      platformContext(),
    );

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ options: expect.arrayContaining(["BodegaHub", "Bodega Sur"]) });
  });

  it("comparar_tiendas includes capital and profit with metrica todas", async () => {
    const result = expectOk(
      await run(
        "comparar_tiendas",
        { from: "2026-05-01", metrica: "todas", to: "2026-05-31" },
        platformContext(),
      ),
    );

    expect((result.data as { ranking: unknown[] }).ranking[0]).toMatchObject({
      capitalRef: expect.any(Number),
      gananciaRef: expect.any(Number),
      ventasRef: expect.any(Number),
    });
  });
});
