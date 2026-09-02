-- =============================================================================
-- 20260830b — One-shot: +1 unidad cerv-pola-lata-250m en venta
-- V-20260830152541402 (4a5bef90-fc4a-422e-ab76-e6a0f160d9fd)
--
-- Linea Polar qty 8 → 9; recalcula totales; sube pago_movil + account_in +
-- vault sale_in (cuenta); stock_movement venta -1.
-- NO toca Polar Light ni compras.
--
-- Idempotente: marker FIX_ADD_POLAR:V-20260830152541402 en stock_movements.reason
-- =============================================================================

do $$
declare
  v_sale_id uuid := '4a5bef90-fc4a-422e-ab76-e6a0f160d9fd';
  v_item_id uuid := '33ea1c87-b05b-49f5-b4f2-9f25a6197ce1';
  v_product_id uuid := '2470a959-0e42-4c0a-b208-fd91bbb4cee1';
  v_payment_id uuid := 'cacac4b6-4c89-4277-ab67-5803540f15b4';
  v_cash_movement_id uuid := '10d496c9-6039-4033-94a7-cde1bba76008';
  v_vault_movement_id uuid := '07b005c4-4d8b-463c-a73b-2ec64b7190be';
  v_marker text := 'FIX_ADD_POLAR:V-20260830152541402';

  v_sale public.sales%rowtype;
  v_item public.sale_items%rowtype;
  v_payment public.payments%rowtype;
  v_product public.products%rowtype;
  v_vault public.store_vaults%rowtype;

  v_rate numeric(14,4);
  v_old_qty integer;
  v_new_qty integer;
  v_delta_qty integer := 1;
  v_unit_price_ref numeric(12,2);
  v_delta_ref numeric(14,2);
  v_delta_ves numeric(14,2);
  v_new_line_subtotal_ves numeric(14,2);
  v_new_subtotal_ref numeric(14,2);
  v_new_total_ref numeric(14,2);
  v_new_total_ves numeric(14,2);
  v_new_amount_ref numeric(14,2);
  v_old_total_ref numeric(14,2);
  v_old_total_ves numeric(14,2);
  v_old_stock integer;
  v_new_stock integer;
begin
  select * into v_sale
  from public.sales
  where id = v_sale_id
    and invoice_number = 'V-20260830152541402'
  for update;

  if not found then
    raise exception 'Venta V-20260830152541402 no encontrada';
  end if;

  if exists (
    select 1 from public.stock_movements
    where sale_id = v_sale_id
      and product_id = v_product_id
      and reason like v_marker || '%'
  ) then
    raise notice 'Correccion % ya aplicada; no se repite.', v_marker;
    return;
  end if;

  select * into v_item
  from public.sale_items
  where id = v_item_id
    and sale_id = v_sale_id
    and product_id = v_product_id
  for update;

  if not found then
    raise exception 'Linea Polar no encontrada en la venta';
  end if;

  select * into v_product
  from public.products
  where id = v_product_id
    and sku = 'cerv-pola-lata-250m'
  for update;

  if not found then
    raise exception 'Producto cerv-pola-lata-250m no encontrado';
  end if;

  if v_item.quantity <> 8 then
    raise exception 'Cantidad Polar inesperada: % (esperaba 8)', v_item.quantity;
  end if;

  if v_product.current_stock < v_delta_qty then
    raise exception 'Stock insuficiente Polar: % (necesita >= %)',
      v_product.current_stock, v_delta_qty;
  end if;

  v_rate := v_sale.ref_rate_ves;
  if v_rate is null or v_rate <= 0 then
    raise exception 'Venta sin tasa ref_rate_ves valida';
  end if;

  v_unit_price_ref := v_item.unit_price_ref;
  v_old_qty := v_item.quantity;
  v_new_qty := v_old_qty + v_delta_qty;
  v_delta_ref := round(v_delta_qty::numeric * v_unit_price_ref, 2);
  v_delta_ves := round(v_delta_ref * v_rate, 2);
  v_new_line_subtotal_ves := round(v_new_qty::numeric * v_unit_price_ref * v_rate, 2);

  v_old_total_ref := v_sale.total_ref;
  v_old_total_ves := v_sale.total_ves;
  v_new_subtotal_ref := round(v_sale.subtotal_ref + v_delta_ref, 2);
  v_new_total_ref := greatest(
    round(v_new_subtotal_ref - coalesce(v_sale.discount_ref, 0) + coalesce(v_sale.tax_ref, 0), 2),
    0
  );
  v_new_total_ves := round(v_new_total_ref * v_rate, 2);
  v_new_amount_ref := round(v_new_total_ves / v_rate, 2);

  v_old_stock := v_product.current_stock;
  v_new_stock := v_old_stock - v_delta_qty;

  update public.sale_items
  set quantity = v_new_qty,
      subtotal_ves = v_new_line_subtotal_ves
  where id = v_item_id;

  update public.sales
  set subtotal_ref = v_new_subtotal_ref,
      total_ref = v_new_total_ref,
      total_ves = v_new_total_ves,
      paid_ves = v_new_total_ves,
      status = 'pagada',
      notes = coalesce(notes, '') ||
        case when notes is null or btrim(notes) = '' then '' else ' | ' end ||
        v_marker || ' +1 Polar',
      updated_at = now()
  where id = v_sale_id;

  select * into v_payment
  from public.payments
  where id = v_payment_id
    and sale_id = v_sale_id
    and method = 'pago_movil'
    and status = 'activo'
  for update;

  if not found then
    raise exception 'Pago pago_movil no encontrado';
  end if;

  update public.payments
  set amount = v_new_total_ves,
      amount_ves = v_new_total_ves,
      amount_ref = v_new_amount_ref,
      notes = coalesce(notes, '') ||
        case when notes is null or btrim(notes) = '' then '' else ' | ' end ||
        v_marker || ' monto +' || v_delta_ves::text
  where id = v_payment_id;

  update public.cash_movements
  set amount_ves = v_new_total_ves,
      notes = coalesce(notes, '') ||
        case when notes is null or btrim(notes) = '' then '' else ' | ' end ||
        v_marker || ' monto +' || v_delta_ves::text
  where id = v_cash_movement_id
    and payment_id = v_payment_id
    and type = 'account_in';

  if not found then
    raise exception 'cash_movement account_in no encontrado';
  end if;

  update public.vault_movements
  set amount_ves = v_new_total_ves,
      notes = coalesce(notes, '') ||
        case when notes is null or btrim(notes) = '' then '' else ' | ' end ||
        v_marker || ' monto +' || v_delta_ves::text
  where id = v_vault_movement_id
    and payment_id = v_payment_id
    and type = 'sale_in'
    and bucket = 'cuenta';

  if not found then
    raise exception 'vault_movement sale_in cuenta no encontrado';
  end if;

  select * into v_vault
  from public.store_vaults
  where id = '174ff529-7467-4775-b06c-fe9426b83aff'
    and store_id = v_sale.store_id
  for update;

  if not found then
    raise exception 'store_vault no encontrado';
  end if;

  update public.store_vaults
  set balance_ves = balance_ves + v_delta_ves,
      updated_at = now()
  where id = v_vault.id;

  insert into public.stock_movements (
    product_id, type, quantity_delta, stock_after, sale_id, purchase_id,
    reason, created_by, store_id
  ) values (
    v_product_id,
    'venta',
    -v_delta_qty,
    v_new_stock,
    v_sale_id,
    null,
    v_marker || ' Venta ' || v_sale.invoice_number || ' +1 Polar',
    v_sale.user_id,
    v_sale.store_id
  );

  update public.products
  set current_stock = v_new_stock,
      updated_at = now()
  where id = v_product_id;

  raise notice
    'OK %: Polar qty %→%, total_ref %→%, total_ves %→%, pago_ves %→%, stock %→%',
    v_sale.invoice_number,
    v_old_qty,
    v_new_qty,
    v_old_total_ref,
    v_new_total_ref,
    v_old_total_ves,
    v_new_total_ves,
    v_payment.amount_ves,
    v_new_total_ves,
    v_old_stock,
    v_new_stock;
end;
$$;
