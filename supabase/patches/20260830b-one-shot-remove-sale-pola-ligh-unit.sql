-- =============================================================================
-- 20260830b — One-shot: remueve 1 u cerv-pola-ligh-lata-250m de venta
-- V-20260829180857754 (a371c7b5-eb65-4f8b-b9f3-6cc4d102d9db)
--
-- Hallazgo: compra 24 u; ventas suman 24 → stock 0.
-- Deseado: stock = 1 (revertir la venta de 1 u Light).
--
-- Linea a remover: sale_item a9a50c39… (qty=1 @ $1 REF / Bs 791.67)
-- Queda en la factura: cerv-pola-lata-250m x2 (REF 2 / Bs 1583.33)
-- Pago: pago_movil → bajar payment + cash account_in + vault sale_in cuenta
--       y balance_ves del baúl en −791.67
--
-- Idempotente si la linea Light ya no existe y total_ref=2 / paid_ves=1583.33
-- =============================================================================

do $$
declare
  v_sale_id uuid := 'a371c7b5-eb65-4f8b-b9f3-6cc4d102d9db';
  v_item_id uuid := 'a9a50c39-0cd1-45b5-bdd3-0f788a1febbd';
  v_product_id uuid := '7c74db16-f1b9-4574-89c3-aa2415a55235';
  v_stock_movement_id uuid := 'e1ae6d55-5984-41c4-9e24-ae7af8839b3d';
  v_payment_id uuid := '46574f69-96dd-465d-8c00-d9c8480c760c';
  v_cash_movement_id uuid := '8c3b0f54-a688-4b30-b3fb-7925955e2291';
  v_vault_movement_id uuid := 'c431c036-d15e-4b1e-8067-cf9960799b8d';
  v_marker text := 'FIX_SALE:V-20260829180857754';

  v_sale public.sales%rowtype;
  v_item public.sale_items%rowtype;
  v_payment public.payments%rowtype;
  v_vault public.store_vaults%rowtype;
  v_rate numeric(14,4);
  v_remove_ref numeric(14,2) := 1;
  v_remove_ves numeric(14,2) := 791.67;
  v_new_subtotal_ref numeric(14,2);
  v_new_total_ref numeric(14,2);
  v_new_total_ves numeric(14,2);
  v_new_paid_ves numeric(14,2);
  v_new_amount_ref numeric(14,2);
  v_old_total_ves numeric(14,2);
  v_stock integer;
  v_item_exists boolean;
begin
  select * into v_sale
  from public.sales
  where id = v_sale_id
  for update;

  if not found then
    raise exception 'Venta % no encontrada', v_sale_id;
  end if;

  select exists(
    select 1 from public.sale_items where id = v_item_id and sale_id = v_sale_id
  ) into v_item_exists;

  v_rate := v_sale.ref_rate_ves;
  if v_rate is null or v_rate <= 0 then
    raise exception 'Venta sin tasa ref_rate_ves valida';
  end if;

  -- Totales esperados tras quitar 1 REF de Light
  v_new_subtotal_ref := round(coalesce(v_sale.subtotal_ref, 0) - v_remove_ref, 2);
  if not v_item_exists then
    -- Ya aplicada: validar estado final
    if v_sale.total_ref = 2
       and v_sale.total_ves = 1583.33
       and v_sale.paid_ves = 1583.33 then
      raise notice 'Venta % ya corregida (sin linea Light, total_ref=2). Nada que hacer.',
        v_sale.invoice_number;
      return;
    end if;
    raise exception
      'Linea Light ausente pero totales inesperados: total_ref=% total_ves=% paid_ves=%',
      v_sale.total_ref, v_sale.total_ves, v_sale.paid_ves;
  end if;

  select * into v_item
  from public.sale_items
  where id = v_item_id
    and sale_id = v_sale_id
    and product_id = v_product_id
  for update;

  if v_item.quantity <> 1 or v_item.unit_price_ref <> 1 then
    raise exception 'Linea Light inesperada: qty=% unit_price_ref=%',
      v_item.quantity, v_item.unit_price_ref;
  end if;

  if round(v_item.subtotal_ves, 2) <> v_remove_ves then
    raise exception 'subtotal_ves linea inesperado: % (esperaba %)',
      v_item.subtotal_ves, v_remove_ves;
  end if;

  if v_sale.subtotal_ref <> 3 or v_sale.total_ref <> 3 or v_sale.total_ves <> 2375 then
    raise exception 'Totales venta inesperados antes del fix: sub=% total_ref=% total_ves=%',
      v_sale.subtotal_ref, v_sale.total_ref, v_sale.total_ves;
  end if;

  v_old_total_ves := v_sale.total_ves;
  v_new_subtotal_ref := 2;
  v_new_total_ref := 2;
  v_new_total_ves := 1583.33;
  v_new_paid_ves := 1583.33;
  v_new_amount_ref := 2;

  -- 1) Eliminar linea
  delete from public.sale_items
  where id = v_item_id;

  -- 2) Eliminar movimiento de stock de esa venta y recalcular stock_after
  delete from public.stock_movements
  where id = v_stock_movement_id
    and sale_id = v_sale_id
    and product_id = v_product_id
    and type = 'venta';

  update public.stock_movements sm
  set stock_after = sub.running
  from (
    select
      id,
      sum(quantity_delta) over (order by created_at asc, id asc) as running
    from public.stock_movements
    where product_id = v_product_id
  ) sub
  where sm.id = sub.id
    and sm.product_id = v_product_id;

  select coalesce(sum(quantity_delta), 0) into v_stock
  from public.stock_movements
  where product_id = v_product_id;

  if v_stock <> 1 then
    raise exception 'Stock recalculado inesperado: % (esperaba 1)', v_stock;
  end if;

  update public.products
  set current_stock = v_stock,
      updated_at = now()
  where id = v_product_id;

  -- 3) Totales venta
  update public.sales
  set subtotal_ref = v_new_subtotal_ref,
      total_ref = v_new_total_ref,
      total_ves = v_new_total_ves,
      paid_ves = v_new_paid_ves,
      status = 'pagada',
      notes = coalesce(notes, '') ||
        case when notes is null or btrim(notes) = '' then '' else ' | ' end ||
        v_marker || ' removida 1u cerv-pola-ligh-lata-250m',
      updated_at = now()
  where id = v_sale_id;

  -- 4) Pago pago_movil
  select * into v_payment
  from public.payments
  where id = v_payment_id
    and sale_id = v_sale_id
  for update;

  if not found then
    raise exception 'Pago no encontrado';
  end if;

  if v_payment.method <> 'pago_movil' then
    raise exception 'Metodo inesperado: % (esperaba pago_movil)', v_payment.method;
  end if;

  if v_payment.amount_ves <> 2375 then
    raise exception 'amount_ves pago inesperado: %', v_payment.amount_ves;
  end if;

  update public.payments
  set amount = v_new_total_ves,
      amount_ves = v_new_total_ves,
      amount_ref = v_new_amount_ref,
      notes = coalesce(notes, '') ||
        case when notes is null or btrim(notes) = '' then '' else ' | ' end ||
        v_marker || ' monto -1u Light (2375→1583.33)'
  where id = v_payment_id;

  -- 5) Caja account_in
  update public.cash_movements
  set amount_ves = v_new_total_ves,
      notes = coalesce(notes, '') ||
        case when notes is null or btrim(notes) = '' then '' else ' | ' end ||
        v_marker || ' monto corregido'
  where id = v_cash_movement_id
    and payment_id = v_payment_id
    and type = 'account_in';

  if not found then
    raise exception 'cash_movement account_in no actualizado';
  end if;

  -- 6) Baúl sale_in cuenta + balance
  update public.vault_movements
  set amount_ves = v_new_total_ves,
      notes = coalesce(notes, '') ||
        case when notes is null or btrim(notes) = '' then '' else ' | ' end ||
        v_marker || ' monto corregido'
  where id = v_vault_movement_id
    and payment_id = v_payment_id
    and type = 'sale_in'
    and bucket = 'cuenta';

  if not found then
    raise exception 'vault_movement sale_in no actualizado';
  end if;

  select * into v_vault
  from public.store_vaults
  where store_id = v_sale.store_id
  for update;

  if not found then
    raise exception 'Baul no encontrado';
  end if;

  if v_vault.balance_ves < v_remove_ves then
    raise exception 'Saldo baul cuenta insuficiente para revertir % (balance=%)',
      v_remove_ves, v_vault.balance_ves;
  end if;

  update public.store_vaults
  set balance_ves = balance_ves - v_remove_ves,
      updated_at = now()
  where id = v_vault.id;

  raise notice
    'OK %: removida 1u Light REF % / VES %; total_ves %→%; stock→%; pago_movil+caja+baúl ajustados',
    v_sale.invoice_number,
    v_remove_ref,
    v_remove_ves,
    v_old_total_ves,
    v_new_total_ves,
    v_stock;
end;
$$;
