-- =============================================================================
-- 20261010e — preferencia "Desarmar siempre al recibir compras" en la receta de
--             apertura de un empaque (COM-14; plan ux-mejoras, Ola 1)
-- Proyecto: BodegaHub
-- Requiere: 20261009d (public.product_pack_conversions como CABECERA de la
--           receta, con su RLS por tienda y rol).
--
-- ANADE una sola columna a la cabecera de la receta:
--
--   public.product_pack_conversions.always_disassemble_on_receive
--     boolean not null default false
--
-- Es una PREFERENCIA de pantalla: con ella en true, la linea de ese empaque
-- nace con el chip "Desarmar al recibir" marcado en /purchases/create (el
-- usuario lo puede desmarcar). La marca que decide el desarme sigue viajando
-- por linea (purchase_items.disassemble_on_receive, parche 20261010d).
--
--   1. No toca funciones, triggers, indices ni politicas. create_purchase,
--      receive_purchase, receive_purchase_and_disassemble y
--      convert_pack_to_units NO leen esta columna: no cambia stock, costo,
--      dinero ni ninguna huella de idempotencia.
--   2. Se LEE por tabla directa (PostgREST) con la RLS de la cabecera: la lee
--      toda la tienda; otra tienda y anon no ven filas. Se ESCRIBE solo por la
--      RPC save_pack_recipe (argumento p_always_disassemble_on_receive, parche
--      20261012a): 20261011d revoca insert / update / delete de authenticated
--      sobre la cabecera, tambien para admin y almacen. Cuando se escribio este
--      parche (rama de Compras) el BFF la escribia por tabla directa; esa via
--      ya no existe.
--   3. Un update que solo nombra esta columna no dispara la reescritura de
--      componentes del trigger de compatibilidad de 20261009d (ese solo
--      reacciona a unit_product_id / units_per_pack).
--   4. No migra datos: toda receta existente queda en false (como hasta hoy).
--   5. La preferencia es de la cabecera: cuando una receta reemplaza a otra
--      (cabecera nueva, la anterior inactiva) save_pack_recipe hace que la
--      nueva herede el valor de la anterior (20261012a).
--
-- ORDEN DE DESPLIEGUE: este parche -> 20261011c -> 20261012a -> verify -> BFF.
-- Orden completo del plan: docs/despliegue-ux-mejoras.md.
-- Idempotente, una transaccion. NO se aplica a produccion desde este plan.
-- Reaplicar 20261009d no elimina la columna (solo anade las suyas): no hace
-- falta reaplicar este parche despues.
-- =============================================================================

begin;

alter table public.product_pack_conversions
  add column if not exists always_disassemble_on_receive boolean not null default false;

comment on column public.product_pack_conversions.always_disassemble_on_receive is
  'Preferencia de pantalla (COM-14): la linea de compra de este empaque nace marcada "Desarmar al recibir". Ninguna RPC la lee.';

notify pgrst, 'reload schema';

commit;
