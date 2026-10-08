-- =============================================================================
-- 20261010f — guarda en base del invariante de "Desarmar al recibir": una
--             compra no queda recibida con una linea marcada sin desarmar
--             (COM-F7 M1, sobre COM-14; plan ux-mejoras, Ola 1; regla 9)
-- Proyecto: BodegaHub
-- Requiere: 20261010d (purchase_items.disassemble_on_receive y
--           disassembled_conversion_id, receive_purchase_and_disassemble).
--
-- Problema. 20261010d declara: "una linea marcada de una compra recibida
-- SIEMPRE tiene su disassembled_conversion_id". receive_purchase_and_disassemble
-- y create_purchase lo cumplen, pero la RPC anterior receive_purchase (20261006c,
-- con execute para authenticated) no sabe nada de la marca: llamada
-- directamente sobre un pedido con una linea marcada dejaba la compra recibida,
-- la marca en true y disassembled_conversion_id en NULL. No existe pantalla ni
-- RPC para completar despues ese desarme.
--
-- Arreglo. Un constraint trigger DIFERIDO sobre public.purchases:
--
--   purchases_received_disassemble_guard
--     after insert or update of status, when (new.status = 'recibido'),
--     deferrable initially deferred, for each row
--
-- Al FINAL de la transaccion que deja una compra en recibido comprueba el
-- invariante: si la compra sigue recibida y le queda alguna linea con
-- disassemble_on_receive = true y disassembled_conversion_id NULL, responde
-- PT409 y la transaccion entera se revierte (ni compra recibida, ni stock, ni
-- costo, ni vinculo).
--
--   1. NO redefine receive_purchase, receive_purchase_and_disassemble,
--      create_purchase ni convert_pack_to_units. No toca tablas, columnas,
--      indices ni politicas. No migra datos.
--   2. Por que diferido: receive_purchase_and_disassemble y create_purchase
--      pasan la compra a recibido y abren los empaques DESPUES, en la misma
--      transaccion. Al final de esa transaccion cada linea marcada ya tiene su
--      conversion: pasan sin cambios. Solo falla el camino que recibe sin
--      desarmar: receive_purchase llamada directamente sobre un pedido marcado.
--   3. receive_purchase sobre un pedido SIN lineas marcadas: igual que hoy.
--   4. receive_purchase_and_disassemble con lista (p_disassemble): la lista
--      sustituye las marcas ANTES de recibir (las lineas que no van quedan en
--      false; [] = ninguna), asi que recibir sin desarmar por la RPC nueva
--      sigue permitido y deja la linea desmarcada.
--   5. Semantica de stock, costo y dinero SIN cambios (regla 9): el trigger
--      solo lee purchases y purchase_items; no escribe nada.
--   6. cancel_purchase / return_purchase no pasan la compra a recibido: el
--      trigger no se dispara.
--   7. El rechazo llega al confirmar la transaccion. Por PostgREST es un 409
--      con el mensaje del PT409; dentro de una transaccion abierta a mano se
--      puede adelantar con
--        set constraints public.purchases_received_disassemble_guard immediate;
--   8. Filas existentes: un constraint trigger no valida lo ya guardado. Una
--      compra que ya hubiera quedado recibida con una linea marcada sin
--      desarmar (solo posible por RPC directa entre 20261010d y este parche)
--      se localiza con:
--        select p.id, p.purchase_number
--        from public.purchases p
--        join public.purchase_items i on i.purchase_id = p.id
--        where p.status = 'recibido'
--          and i.disassemble_on_receive
--          and i.disassembled_conversion_id is null;
--
-- Idempotente, una sola transaccion. NO se aplica a produccion desde este plan.
-- Reaplicar 20261010d no elimina el trigger ni su funcion: no hace falta
-- reaplicar este parche despues.
-- =============================================================================

begin;

create or replace function public.purchases_received_disassemble_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Estado al final de la transaccion, no el de la fila que disparo el trigger.
  if exists (
    select 1
    from public.purchases p
    join public.purchase_items i on i.purchase_id = p.id
    where p.id = new.id
      and p.status = 'recibido'
      and i.disassemble_on_receive
      and i.disassembled_conversion_id is null
  ) then
    raise exception using
      errcode = 'PT409',
      message = 'Esta compra tiene líneas marcadas para desarmar: recíbela desde la pantalla de la compra para abrir sus empaques o desmarcarlas. No se recibió nada.';
  end if;

  return null;
end;
$$;

comment on function public.purchases_received_disassemble_guard() is
  'Invariante de COM-14: una compra recibida no conserva lineas marcadas "Desarmar al recibir" sin disassembled_conversion_id. Solo lee.';

revoke all on function public.purchases_received_disassemble_guard() from public, anon, authenticated;

drop trigger if exists purchases_received_disassemble_guard on public.purchases;

create constraint trigger purchases_received_disassemble_guard
  after insert or update of status on public.purchases
  deferrable initially deferred
  for each row
  when (new.status = 'recibido')
  execute function public.purchases_received_disassemble_guard();

commit;

notify pgrst, 'reload schema';
