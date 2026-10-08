-- =============================================================================
-- 20261009a — % de ganancia del producto como columna generada (PRO-07)
-- Proyecto: BodegaHub (plan ux-mejoras, Ola 1)
-- Requiere: tabla public.products (schema base). No depende de otros parches.
--
--   products.margin_pct = (sale_price_ref - current_cost_ref) / current_cost_ref * 100
--
--   Ganancia = markup sobre el costo, todo en REF. current_cost_ref YA incluye
--   el IVA: aqui no se aplica ningun impuesto. Mismo calculo que markupPct de
--   @bodega/core (packages/core/src/pricing.ts), con sus mismos 6 decimales,
--   para que la banda del filtro del listado (GET /api/products?margin=...) y
--   la del semaforo que pinta la pantalla coincidan siempre.
--     * Costo 0 -> NULL ("Sin costo"): nunca division por cero.
--     * Precio por debajo del costo -> % negativo.
--   PostgREST no filtra ni ordena por expresion: por eso es una columna
--   GENERADA y ALMACENADA. Nadie la escribe; Postgres la recalcula sola cuando
--   cambia sale_price_ref o current_cost_ref (ediciones, update_product_price,
--   compras recibidas, importacion). No toca stock, dinero ni ninguna RPC.
--
--   Indice (store_id, margin_pct): filtro por banda y orden por % del listado.
--
-- OJO al aplicarlo: anadir una columna generada almacenada reescribe la tabla
-- products con bloqueo exclusivo durante la reescritura (corta con el catalogo
-- de una bodega; aplicarlo fuera de hora pico). No dispara triggers de fila.
-- Los triggers trg_zz_reject_non_finite_numeric_* (20261006i) ignoran las
-- columnas generadas: no hace falta reaplicar ese parche.
--
-- Idempotente (add column / create index if not exists), una sola transaccion.
-- Ejecutar en SQL Editor o via db-up ANTES de desplegar el BFF que filtra y
-- ordena por margin_pct.
-- =============================================================================

begin;

alter table public.products
  add column if not exists margin_pct numeric
  generated always as (
    case
      when current_cost_ref > 0
        then round((sale_price_ref - current_cost_ref) / current_cost_ref * 100, 6)
    end
  ) stored;

comment on column public.products.margin_pct is
  'Ganancia sobre el costo en % (markup en REF; el costo ya incluye IVA). NULL si el costo es 0. Columna generada: no se escribe.';

create index if not exists products_store_margin_pct_idx
  on public.products (store_id, margin_pct);

commit;

notify pgrst, 'reload schema';
