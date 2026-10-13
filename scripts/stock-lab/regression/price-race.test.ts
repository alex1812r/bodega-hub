/** @jest-environment node */
/**
 * PRO-F9 · regresión del parche `20261009f-price-and-product-idempotency.sql` (hallazgos de caos ALTA-1, M1 y ALTA-2).
 *
 *   ALTA-1  el reprecio masivo calculaba el precio en el BFF con un costo leído antes: si en medio se recibía una
 *           compra, el precio quedaba por debajo del costo nuevo, la respuesta era de éxito y el producto salía de
 *           "Por revisar". Ahora el precio se calcula en `reprice_product_to_markup` con el producto bloqueado.
 *   M1      "Mantener precio" guardaba una ganancia que el usuario no vio: `keep_product_price` acepta el costo esperado.
 *   ALTA-2  reintentar un alta de producto creaba otro producto y otro `inventario_inicial`: `products.client_request_id`
 *           con índice único por tienda, y el stock inicial por `adjust_stock` con clave.
 *
 * Cada test enuncia el comportamiento SANO. Las carreras son reales: dos conexiones `pg` con datos confirmados
 * (productos sin stock ni compras, que se borran al terminar). El resto corre dentro de una transacción que termina en
 * `rollback`, con cada sentencia probada bajo `set local role authenticated` + `request.jwt.claims` del usuario lab.
 *
 *   npm run stock-lab:test -- scripts/stock-lab/regression/price-race.test.ts
 *
 * Un fallo de preparación empieza por "SETUP".
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Client } from "pg";

import { priceFromMarkup } from "@bodega/core";

import type { LabRoleKey } from "../agents/base";
import { withRollback } from "../db-test-utils";
import { Lab, actAs } from "../scenarios/db";

type Row = Record<string, unknown>;
type Outcome = { rows: Row[]; code: string | null; message: string; hint: string | null; constraint: string | null };

const PATCHES = resolve(__dirname, "../../../supabase/patches");
const TAG = `PROF9-${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
const INDEX = "products_store_client_request_unique";

let lab: Lab;
let db: Client;
let other: Client;
let seq = 0;
const committed: string[] = [];

function failure(error: unknown): Omit<Outcome, "rows"> {
  const e = error as { code?: unknown; hint?: unknown; constraint?: unknown };
  return {
    code: typeof e.code === "string" ? e.code : "?",
    message: error instanceof Error ? error.message : String(error),
    hint: typeof e.hint === "string" ? e.hint : null,
    constraint: typeof e.constraint === "string" ? e.constraint : null,
  };
}

const OK = { code: null, message: "", hint: null, constraint: null };

async function sql(what: string, text: string, params: unknown[] = [], client: Client = db): Promise<Row[]> {
  try {
    return (await client.query<Row>(text, params)).rows;
  } catch (error) {
    const { code, message } = failure(error);
    throw new Error(`SETUP · ${what}: ${code} ${message}`);
  }
}

/** Dentro de la transacción del test: `text` en un savepoint como el usuario lab `role` (o `anon`). */
async function run(role: LabRoleKey | "anon", text: string, params: unknown[] = []): Promise<Outcome> {
  await db.query("savepoint prof9");
  try {
    await actAs(db, role === "anon" ? null : lab.uids[role]);
    const res = await db.query<Row>(text, params);
    await db.query("reset role");
    await db.query("release savepoint prof9");
    return { rows: res.rows, ...OK };
  } catch (error) {
    await db.query("rollback to savepoint prof9");
    await db.query("reset role");
    return { rows: [], ...failure(error) };
  }
}

/** Transacción propia y CONFIRMADA en `client` como el usuario lab `role`: lo que hace una llamada /rpc de PostgREST. */
async function call(client: Client, role: LabRoleKey, text: string, params: unknown[] = []): Promise<Outcome> {
  await client.query("begin");
  try {
    await actAs(client, lab.uids[role]);
    const res = await client.query<Row>(text, params);
    await client.query("commit");
    return { rows: res.rows, ...OK };
  } catch (error) {
    await client.query("rollback");
    return { rows: [], ...failure(error) };
  }
}

/** Producto como `postgres` (el trigger de las altas le pone su línea base). `commit`: fuera de transacción, se borra al final. */
async function product(costRef: number, priceRef: number, options: { storeId?: string; commit?: boolean } = {}): Promise<string> {
  seq += 1;
  const sku = `${TAG}-${seq}`.toLowerCase();
  const rows = await sql(
    `producto ${sku}`,
    `insert into public.products (store_id, sku, name, sale_price_ref, current_cost_ref, current_stock, min_stock)
     values ($1, $2, $2, $3, $4, 0, 0) returning id`,
    [options.storeId ?? lab.storeId, sku, priceRef, costRef],
  );
  const id = String(rows[0]?.id);
  if (options.commit) committed.push(id);
  return id;
}

async function state(ids: readonly string[], client: Client = db): Promise<Row[]> {
  return sql(
    "estado",
    `select p.id, p.sale_price_ref::float8 as precio, p.current_cost_ref::float8 as costo,
            (select count(*)::int from public.product_price_history h where h.product_id = p.id) as filas,
            (select h.cost_ref_snapshot::float8 from public.product_price_history h
              where h.product_id = p.id order by h.snapshot_seq desc limit 1) as costo_snap,
            exists (select 1 from public.products_price_review r where r.product_id = p.id) as en_cola
     from public.products p where p.id = any($1::uuid[]) order by p.sku`,
    [ids],
    client,
  );
}

/** Espera a que la conexión `pid` esté detenida en un bloqueo: la carrera queda montada, no supuesta. */
async function waitUntilBlocked(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const rows = await lab.rows("select wait_event_type from pg_stat_activity where pid = $1", [pid]);
    if (rows[0]?.wait_event_type === "Lock") return;
    await new Promise((done) => setTimeout(done, 25));
  }
  throw new Error("SETUP · la segunda conexión no llegó a esperar el bloqueo del producto");
}

/**
 * `statement` (conexión `other`, como almacén) arranca mientras `db` tiene el producto bloqueado dentro de una
 * transacción que le sube el costo a `newCost`, igual que una recepción de compra en curso. Devuelve el resultado.
 */
async function raceAgainstCostChange(productId: string, newCost: number, statement: string, params: unknown[]): Promise<Outcome> {
  const pid = Number((await sql("pid", "select pg_backend_pid() as pid", [], other))[0]?.pid);
  await db.query("begin");
  let pending: Promise<Outcome>;
  try {
    await db.query("select id from public.products where id = $1 for update", [productId]);
    pending = call(other, "almacen", statement, params);
    await waitUntilBlocked(pid);
    await db.query("update public.products set current_cost_ref = $2 where id = $1", [productId, newCost]);
    await db.query("commit");
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
  return pending;
}

const REPRICE = "select sale_price_ref::float8 as precio from public.reprice_product_to_markup($1::uuid, $2::numeric, $3, $4::numeric)";
const CHECKED = "select sale_price_ref::float8 as precio from public.update_product_price_checked($1::uuid, $2::numeric, $3, $4::numeric)";
const KEEP = "select id from public.keep_product_price($1::uuid, $2, $3::numeric)";

beforeAll(async () => {
  lab = await Lab.open("prof9");
  db = await lab.pg();
  other = await lab.pg();
});

afterAll(async () => {
  if (!lab) return;
  try {
    if (committed.length > 0) await lab.rows("delete from public.products where id = any($1::uuid[])", [committed]);
  } finally {
    await lab.close();
  }
});

describe("price_from_markup · mismo redondeo que priceFromMarkup de @bodega/core", () => {
  it("coincide al céntimo en los bordes de medio céntimo, en importes mínimos y máximos y en 400 pares pseudoaleatorios", async () => {
    const pairs: [number, number][] = [
      [1.02, 25], // 1.275 exacto: en coma flotante da 1.27499…
      [0.01, 0.01],
      [0.01, 50], // 0.015 -> 0.02
      [0.05, 10], // 0.055 -> 0.06
      [0.03, 16.67],
      [10, 30],
      [12, 30],
      [20, 30],
      [8, 25],
      [9.99, 12.5],
      [1.15, 15],
      [2.35, 0.5],
      [33.33, 33.33],
      [999999.99, 1000],
      [1234567.89, 999.99],
      [0.5, 1000],
      [7, 0.01],
      [0, 30],
      [-5, 30],
    ];
    // Generador determinista: el mismo lote en cada corrida.
    let seed = 20261009;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };
    for (let index = 0; index < 400; index += 1) {
      pairs.push([(next() % 5_000_000) / 100, (1 + (next() % 100_000)) / 100]);
    }

    const rows = await sql(
      "price_from_markup",
      `select public.price_from_markup(c, p)::float8 as precio
       from unnest($1::numeric[], $2::numeric[]) with ordinality as t(c, p, n) order by n`,
      [pairs.map(([cost]) => cost), pairs.map(([, pct]) => pct)],
    );

    const differences = pairs
      .map(([cost, pct], index) => ({ cost, pct, sql: rows[index]?.precio, core: priceFromMarkup(cost, pct) }))
      .filter((row) => row.sql !== row.core);

    expect({ pares: pairs.length, diferencias: differences }).toEqual({ pares: 419, diferencias: [] });
  });
});

describe("ALTA-1 · reprecio solapado con un cambio de costo (dos conexiones, datos confirmados)", () => {
  it("con costo esperado: el reprecio que esperaba el costo viejo responde PT409 y no cambia precio ni historial", async () => {
    const id = await product(12, 16, { commit: true });
    const out = await raceAgainstCostChange(id, 20, REPRICE, [id, 30, "Reprecio al 30 %", 12]);

    expect({ code: out.code, hint: out.hint, message: out.message, estado: await state([id]) }).toEqual({
      code: "PT409",
      hint: "COST_CHANGED",
      message: "El costo cambió de 12.00 a 20.00; revisa el precio",
      // Sigue en 16 con su línea base (costo 12, verde): al costar 20 está en la cola, nadie la apagó.
      estado: [{ id, precio: 16, costo: 20, filas: 1, costo_snap: 12, en_cola: true }],
    });
  });

  it("sin costo esperado: el precio sale del costo NUEVO (nunca del leído antes) y la instantánea guarda ese costo", async () => {
    const id = await product(12, 13, { commit: true });
    const out = await raceAgainstCostChange(id, 20, REPRICE, [id, 30, "Reprecio al 30 %", null]);

    expect({ code: out.code, devuelto: out.rows[0]?.precio, estado: await state([id]) }).toEqual({
      code: null,
      devuelto: priceFromMarkup(20, 30),
      estado: [{ id, precio: 26, costo: 20, filas: 2, costo_snap: 20, en_cola: false }],
    });
  });

  it("precio fijo con costo esperado (aviso de compra, tarjeta de precio): PT409 y nada cambia", async () => {
    const id = await product(12, 16, { commit: true });
    const out = await raceAgainstCostChange(id, 20, CHECKED, [id, 17, "Reprecio al 30 %", 12]);

    expect({ code: out.code, hint: out.hint, estado: await state([id]) }).toEqual({
      code: "PT409",
      hint: "COST_CHANGED",
      estado: [{ id, precio: 16, costo: 20, filas: 1, costo_snap: 12, en_cola: true }],
    });
  });

  it("M1 · mantener precio con el costo viejo: PT409 y no inserta la instantánea que apagaría la cola", async () => {
    const id = await product(10, 12.5, { commit: true });
    const out = await raceAgainstCostChange(id, 14, KEEP, [id, null, 10]);

    expect({ code: out.code, hint: out.hint, message: out.message, estado: await state([id]) }).toEqual({
      code: "PT409",
      hint: "COST_CHANGED",
      message: "El costo cambió de 10.00 a 14.00; revisa el precio",
      estado: [{ id, precio: 12.5, costo: 14, filas: 1, costo_snap: 10, en_cola: true }],
    });
  });

  it("lote de 40 productos mientras otra conexión sube el costo de todos: ninguno queda bajo el % pedido y fuera de la cola", async () => {
    const ids: string[] = [];
    for (let index = 0; index < 40; index += 1) ids.push(await product(12, 13, { commit: true }));

    let costChange: Promise<Row[]> | null = null;
    const codes: (string | null)[] = [];
    for (const [index, id] of ids.entries()) {
      // A mitad del lote, sin esperar: el update compite de verdad con las llamadas siguientes.
      if (index === 12) {
        costChange = sql("subida de costo", "update public.products set current_cost_ref = 20 where id = any($1::uuid[]) returning id", [ids]);
      }
      codes.push((await call(other, "almacen", REPRICE, [id, 30, "Reprecio al 30 %", null])).code);
    }
    await costChange;

    const rows = await state(ids);
    const bad = rows.filter((row) => Number(row.precio) < priceFromMarkup(Number(row.costo), 30) && row.en_cola !== true);
    const prices = [...new Set(rows.map((row) => row.precio))].sort();

    expect({
      errores: codes.filter((code) => code !== null),
      costos: [...new Set(rows.map((row) => row.costo))],
      bajoElPorcentajeYFueraDeLaCola: bad,
      // 15.6 = 30 % sobre 12 (repreciados ANTES de la subida: quedan en la cola); 26 = 30 % sobre 20.
      preciosFueraDeLoEsperado: prices.filter((price) => price !== 15.6 && price !== 26),
      hayRepreciadosConElCostoNuevo: prices.includes(26),
    }).toEqual({
      errores: [],
      costos: [20],
      bajoElPorcentajeYFueraDeLaCola: [],
      preciosFueraDeLoEsperado: [],
      hayRepreciadosConElCostoNuevo: true,
    });
  });
});

describe("reprice_product_to_markup / update_product_price_checked / keep_product_price · validaciones y permisos", () => {
  it("% fuera de (0, 1000] o no finito y producto sin costo responden PT400 sin cambiar nada", async () => {
    await withRollback(db, async () => {
      const id = await product(8, 10);
      const noCost = await product(0, 10);
      const codes: Record<string, string | null> = {};
      for (const pct of ["0", "-1", "1000.01", "NaN", "Infinity"]) {
        codes[pct] = (await run("almacen", REPRICE, [id, pct, null, null])).code;
      }
      const top = await run("almacen", REPRICE, [id, "1000", null, null]);
      const without = await run("admin", REPRICE, [noCost, 30, null, null]);
      const nanExpected = await run("admin", REPRICE, [id, 30, null, "NaN"]);

      expect({ codes, tope: top.rows[0]?.precio, sinCosto: [without.code, without.hint, without.message], esperadoNaN: nanExpected.code, estado: await state([noCost]) }).toEqual({
        codes: { "0": "PT400", "-1": "PT400", "1000.01": "PT400", NaN: "PT400", Infinity: "PT400" },
        tope: 88,
        sinCosto: ["PT400", "NO_COST", "Sin costo no se puede calcular el precio"],
        esperadoNaN: "PT400",
        estado: [{ id: noCost, precio: 10, costo: 0, filas: 1, costo_snap: 0, en_cola: false }],
      });
    });
  });

  it("solo admin y almacén (PT403), solo productos de la propia tienda (PT404) y anon no las ejecuta", async () => {
    await withRollback(db, async () => {
      const id = await product(8, 10);
      const foreign = await product(8, 10, { storeId: lab.defaultStoreId });
      const calls: Record<string, [string, unknown[], unknown[]]> = {
        reprice: [REPRICE, [id, 30, null, null], [foreign, 30, null, null]],
        checked: [CHECKED, [id, 11, null, 8], [foreign, 11, null, 8]],
        keep: [KEEP, [id, null, 8], [foreign, null, 8]],
      };
      const actual: Record<string, unknown> = {};
      for (const [name, [text, own, theirs]] of Object.entries(calls)) {
        actual[name] = {
          vendedor: (await run("vendedor1", text, own)).code,
          contador: (await run("contador", text, own)).code,
          anon: (await run("anon", text, own)).code,
          otraTienda: (await run("admin", text, theirs)).code,
          sinExistir: (await run("admin", text, [randomUUID(), ...own.slice(1)])).code,
        };
      }
      const denied = { vendedor: "PT403", contador: "PT403", anon: "42501", otraTienda: "PT404", sinExistir: "PT404" };

      expect({ actual, estado: await state([id, foreign]) }).toEqual({
        actual: { reprice: denied, checked: denied, keep: denied },
        estado: [
          { id, precio: 10, costo: 8, filas: 1, costo_snap: 8, en_cola: false },
          { id: foreign, precio: 10, costo: 8, filas: 1, costo_snap: 8, en_cola: false },
        ],
      });
    });
  });

  it("el costo esperado se compara a dos decimales: 8.004 vale por 8.00 y 8.01 no", async () => {
    await withRollback(db, async () => {
      const id = await product(8, 10);
      const near = await run("almacen", KEEP, [id, null, "8.004"]);
      const far = await run("almacen", KEEP, [id, null, "8.01"]);
      const repriced = await run("almacen", REPRICE, [id, 25, null, "8.00"]);

      expect({ cerca: near.code, lejos: [far.code, far.message], reprecio: repriced.rows[0]?.precio }).toEqual({
        cerca: null,
        lejos: ["PT409", "El costo cambió de 8.01 a 8.00; revisa el precio"],
        reprecio: 10,
      });
    });
  });

  it("keep_product_price tiene una sola firma y la llamada de dos argumentos sigue funcionando", async () => {
    await withRollback(db, async () => {
      const id = await product(8, 10);
      const signatures = await sql(
        "firmas",
        "select pg_get_function_identity_arguments(oid) as args from pg_proc where pronamespace = 'public'::regnamespace and proname = 'keep_product_price'",
      );
      const kept = await run("almacen", "select reason from public.keep_product_price($1::uuid, $2)", [id, null]);
      const named = await run("almacen", "select reason from public.keep_product_price(p_product_id => $1::uuid)", [id]);

      expect({ firmas: signatures.map((row) => row.args), dos: kept.rows[0]?.reason, nombrada: named.rows[0]?.reason }).toEqual({
        firmas: ["p_product_id uuid, p_reason text, p_expected_cost_ref numeric"],
        dos: "Precio mantenido",
        nombrada: "Precio mantenido",
      });
    });
  });
});

describe("diferencial · el camino sin costo esperado no cambia de resultado", () => {
  /** Ejecuta `text` como almacén, lee producto + última fila de historial y deshace: cada variante parte del mismo estado. */
  async function effect(id: string, text: string, params: unknown[]): Promise<Row> {
    await db.query("savepoint prof9_diff");
    try {
      const out = await run("almacen", text, params);
      const rows = await sql(
        "efecto",
        `select p.sale_price_ref::float8 as precio, p.current_cost_ref::float8 as costo, p.margin_pct::float8 as pct, p.current_stock as stock,
                h.old_sale_price_ref::float8 as antes, h.new_sale_price_ref::float8 as despues, h.reason, h.changed_by,
                h.cost_ref_snapshot::float8 as costo_snap, h.margin_band_snapshot as banda,
                (select count(*)::int from public.product_price_history x where x.product_id = p.id) as filas
         from public.products p
         join lateral (select * from public.product_price_history h where h.product_id = p.id order by h.snapshot_seq desc limit 1) h on true
         where p.id = $1`,
        [id],
      );
      return { code: out.code, devuelto: out.rows[0]?.precio ?? null, ...rows[0] };
    } finally {
      await db.query("rollback to savepoint prof9_diff");
    }
  }

  it("update_product_price es, letra por letra, la de 20261009c", async () => {
    const patch = readFileSync(resolve(PATCHES, "20261009c-price-review.sql"), "utf8").replace(/\r\n/g, "\n");
    const body = /create or replace function public\.update_product_price\([\s\S]*?\nas \$\$\n([\s\S]*?)\n\$\$;/.exec(patch)?.[1];
    const rows = await sql(
      "cuerpo vigente",
      "select btrim(replace(prosrc, E'\\r\\n', E'\\n'), E'\\n') as src from pg_proc where oid = 'public.update_product_price(uuid, numeric, text)'::regprocedure",
    );

    expect(body).toBeTruthy();
    expect(rows[0]?.src).toBe(body);
  });

  it("precio fijo: update_product_price, la variante comprobada sin costo esperado y con el costo correcto dejan lo mismo", async () => {
    await withRollback(db, async () => {
      const id = await product(8, 10);
      const UPDATE = "select sale_price_ref::float8 as precio from public.update_product_price($1::uuid, $2::numeric, $3)";
      const base = await effect(id, UPDATE, [id, 11.37, "Cambio"]);
      const unchecked = await effect(id, CHECKED, [id, 11.37, "Cambio", null]);
      const checked = await effect(id, CHECKED, [id, 11.37, "Cambio", 8]);

      expect(base).toMatchObject({ code: null, devuelto: 11.37, precio: 11.37, antes: 10, despues: 11.37, costo_snap: 8, banda: "green", filas: 2, stock: 0 });
      expect({ sinEsperado: unchecked, conEsperado: checked }).toEqual({ sinEsperado: base, conEsperado: base });
    });
  });

  it("reprecio al %: deja lo mismo que update_product_price con el precio de priceFromMarkup, con y sin costo esperado", async () => {
    await withRollback(db, async () => {
      const id = await product(1.02, 1.1);
      const UPDATE = "select sale_price_ref::float8 as precio from public.update_product_price($1::uuid, $2::numeric, $3)";
      const base = await effect(id, UPDATE, [id, priceFromMarkup(1.02, 25), "Reprecio al 25 %"]);
      const repriced = await effect(id, REPRICE, [id, 25, "Reprecio al 25 %", null]);
      const expected = await effect(id, REPRICE, [id, 25, "Reprecio al 25 %", 1.02]);

      expect(base).toMatchObject({ code: null, precio: 1.28, antes: 1.1, despues: 1.28, costo_snap: 1.02, filas: 2 });
      expect({ sinEsperado: repriced, conEsperado: expected }).toEqual({ sinEsperado: base, conEsperado: base });
    });
  });
});

describe("ALTA-2 · clave de idempotencia del alta de producto", () => {
  const row = (sku: string, key: string | null, storeId: string): unknown[] => [storeId, sku, key];
  const INSERT = `insert into public.products (store_id, sku, name, sale_price_ref, current_cost_ref, current_stock, min_stock, client_request_id)
                  values ($1, $2, $2, 5, 3, 0, 0, $3::uuid) returning id`;

  it("la misma clave en la misma tienda choca con el índice único (23505 que lo nombra); sin clave u otra tienda no chocan", async () => {
    await withRollback(db, async () => {
      const key = randomUUID();
      const first = await run("almacen", INSERT, row(`${TAG}-k1`.toLowerCase(), key, lab.storeId));
      const retry = await run("almacen", INSERT, row(`${TAG}-k2`.toLowerCase(), key, lab.storeId));
      const noKeyA = await run("almacen", INSERT, row(`${TAG}-k3`.toLowerCase(), null, lab.storeId));
      const noKeyB = await run("almacen", INSERT, row(`${TAG}-k4`.toLowerCase(), null, lab.storeId));
      const otherStore = await sql("otra tienda", INSERT, row(`${TAG}-k5`.toLowerCase(), key, lab.defaultStoreId));
      const found = await sql("productos con la clave", "select count(*)::int as n from public.products where store_id = $1 and client_request_id = $2", [lab.storeId, key]);
      const baseline = await sql("línea base", "select count(*)::int as n from public.product_price_history where product_id = $1", [first.rows[0]?.id]);

      expect({
        primera: first.code,
        reintento: [retry.code, retry.constraint],
        sinClave: [noKeyA.code, noKeyB.code],
        otraTienda: otherStore.length,
        conLaClave: found[0]?.n,
        lineaBase: baseline[0]?.n,
      }).toEqual({ primera: null, reintento: ["23505", INDEX], sinClave: [null, null], otraTienda: 1, conLaClave: 1, lineaBase: 1 });
    });
  });

  it("alta doble con la misma clave: 1 producto y 1 inventario_inicial de 9 (el stock inicial repetido devuelve el mismo movimiento)", async () => {
    await withRollback(db, async () => {
      const key = randomUUID();
      const stockKey = randomUUID();
      const ADJUST = `select id from public.adjust_stock(p_product_id => $1::uuid, p_quantity_delta => 9, p_reason => 'Inventario inicial al crear el producto',
                        p_type => 'inventario_inicial', p_client_request_id => $2::uuid)`;
      const first = await run("almacen", INSERT, row(`${TAG}-s1`.toLowerCase(), key, lab.storeId));
      const id = String(first.rows[0]?.id);
      const stock = await run("almacen", ADJUST, [id, stockKey]);
      // Reintento del MISMO envío: el alta choca con el índice y el stock inicial viaja con la misma clave derivada.
      const retry = await run("almacen", INSERT, row(`${TAG}-s2`.toLowerCase(), key, lab.storeId));
      const stockRetry = await run("almacen", ADJUST, [id, stockKey]);
      const totals = await sql(
        "totales",
        `select (select count(*)::int from public.products where store_id = $1 and client_request_id = $2) as productos,
                (select count(*)::int from public.stock_movements where product_id = $3 and type = 'inventario_inicial') as movimientos,
                (select coalesce(sum(quantity_delta), 0)::int from public.stock_movements where product_id = $3) as unidades,
                (select current_stock from public.products where id = $3) as stock`,
        [lab.storeId, key, id],
      );

      expect({
        codigos: [first.code, stock.code, retry.code, stockRetry.code],
        mismoMovimiento: stock.rows[0]?.id === stockRetry.rows[0]?.id,
        totales: totals[0],
      }).toEqual({
        codigos: [null, null, "23505", null],
        mismoMovimiento: true,
        totales: { productos: 1, movimientos: 1, unidades: 9, stock: 9 },
      });
    });
  });

  it("PostgREST (el camino del BFF): el segundo insert con la misma clave responde 23505 y su mensaje nombra el índice", async () => {
    const almacen = await lab.supa("almacen");
    const key = randomUUID();
    const ids: string[] = [];

    try {
      const results = [];
      for (const suffix of ["rest-a", "rest-b"]) {
        const sku = `${TAG}-${suffix}`.toLowerCase();
        const out = await almacen
          .from("products")
          .insert({ store_id: lab.storeId, sku, name: sku, sale_price_ref: 5, current_cost_ref: 3, current_stock: 0, min_stock: 0, client_request_id: key, client_request_hash: "h" })
          .select("id")
          .single();
        if (out.data) ids.push(String(out.data.id));
        results.push({ code: out.error?.code ?? null, nombraElIndice: `${out.error?.message ?? ""} ${out.error?.details ?? ""}`.includes(INDEX) });
      }
      const existing = await almacen.from("products").select("id, client_request_hash").eq("store_id", lab.storeId).eq("client_request_id", key);

      expect({ results, existentes: existing.data }).toEqual({
        results: [
          { code: null, nombraElIndice: false },
          { code: "23505", nombraElIndice: true },
        ],
        existentes: [{ id: ids[0], client_request_hash: "h" }],
      });
    } finally {
      await lab.rows("delete from public.products where id = any($1::uuid[])", [ids]);
    }
  });
});

// Lo que el BFF necesita de PostgREST: que las RPC se resuelvan por nombre de argumento (también la llamada de dos
// argumentos a keep_product_price, que el BFF sigue haciendo sin costo esperado) y que el `hint` del rechazo llegue en
// el error, porque con él distingue COST_CHANGED y NO_COST en las filas del reprecio.
describe("PostgREST · las RPC de precio tal como las llama el BFF", () => {
  it("resuelve las firmas por nombre, devuelve el precio calculado y entrega code + hint + mensaje del rechazo", async () => {
    const almacen = await lab.supa("almacen");
    const id = await product(12, 16, { commit: true });
    const noCost = await product(0, 4, { commit: true });
    const shape = (out: { data: unknown; error: { code?: string; hint?: string; message: string } | null }) =>
      out.error ? { code: out.error.code, hint: out.error.hint ?? null, message: out.error.message } : null;

    const stale = await almacen.rpc("reprice_product_to_markup", { p_expected_cost_ref: 11, p_markup_pct: 30, p_product_id: id, p_reason: "Reprecio al 30 %" });
    const without = await almacen.rpc("reprice_product_to_markup", { p_expected_cost_ref: null, p_markup_pct: 30, p_product_id: noCost, p_reason: null });
    const repriced = await almacen.rpc("reprice_product_to_markup", { p_expected_cost_ref: 12, p_markup_pct: 30, p_product_id: id, p_reason: "Reprecio al 30 %" });
    const checkedStale = await almacen.rpc("update_product_price_checked", { p_expected_cost_ref: 11, p_new_sale_price_ref: 17, p_product_id: id, p_reason: null });
    const checked = await almacen.rpc("update_product_price_checked", { p_expected_cost_ref: 12, p_new_sale_price_ref: 17, p_product_id: id, p_reason: null });
    const keepStale = await almacen.rpc("keep_product_price", { p_expected_cost_ref: 11, p_product_id: id, p_reason: null });
    const keepTwoArgs = await almacen.rpc("keep_product_price", { p_product_id: id, p_reason: null });

    const costChanged = { code: "PT409", hint: "COST_CHANGED", message: "El costo cambió de 11.00 a 12.00; revisa el precio" };
    expect({
      reprecioViejo: shape(stale),
      sinCosto: shape(without),
      reprecio: [shape(repriced), Number((repriced.data as Row | null)?.sale_price_ref)],
      fijoViejo: shape(checkedStale),
      fijo: [shape(checked), Number((checked.data as Row | null)?.sale_price_ref)],
      mantenerViejo: shape(keepStale),
      mantenerDosArgumentos: [shape(keepTwoArgs), (keepTwoArgs.data as Row | null)?.reason],
      estado: await state([id, noCost]),
    }).toEqual({
      reprecioViejo: costChanged,
      sinCosto: { code: "PT400", hint: "NO_COST", message: "Sin costo no se puede calcular el precio" },
      reprecio: [null, 15.6],
      fijoViejo: costChanged,
      fijo: [null, 17],
      mantenerViejo: costChanged,
      mantenerDosArgumentos: [null, "Precio mantenido"],
      // Línea base + reprecio + precio fijo + mantener: los tres rechazos no dejaron fila.
      estado: [
        { id, precio: 17, costo: 12, filas: 4, costo_snap: 12, en_cola: false },
        { id: noCost, precio: 4, costo: 0, filas: 1, costo_snap: 0, en_cola: false },
      ],
    });
  });
});
