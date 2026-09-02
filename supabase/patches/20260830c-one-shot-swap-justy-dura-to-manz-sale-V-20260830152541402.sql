-- =============================================================================
-- 20260830c — One-shot: swap just-dura-400-ml → just-manz-15-lt en venta
-- V-20260830152541402 (4a5bef90-fc4a-422e-ab76-e6a0f160d9fd)
--
-- Reemplaza linea Justy Durazno 400ml ×1 por Justy Manzana 1.5lt ×1.
-- Preserva Polar qty 9, chee-tris, doritos. Recalcula totales; ajusta
-- pago_movil + account_in + vault sale_in (cuenta) + balance_ves.
-- Restock +1 dura (ajuste_entrada); venta −1 manzana.
-- NO toca Polar Light ni compras.
--
-- Idempotente: marker FIX_SWAP_JUSTY:V-20260830152541402 en stock_movements.reason
-- =============================================================================

do $$
declare
  v_sale_id uuid := '4a5bef90-fc4a-422e-ab76-e6a0f160d9fd';
  v_item_id uuid := 'd4d7b7b0-3b20-4c46-abd5-5a3387758a5f';
  v_dura_id uuid := '7ddb153f-f97b-433e-85c3-8c0c5c893896';
  v_manz_id uuid := '0c6d2ebc-3ead-48e1-9745-ec9f1b2e0a08';
  v_payment_id uuid := 'cacac4b6-4c89-4277-ab67-5803540f15b4';
  v_cash_movement_id uuid := '10d496c9-6039-4033-94a7-cde1bba76008';
  v_vault_movement_id uuid := '07b005c4-4d8b-463c-a73b-2ec64b7190be';
  v_vault_id uuid := '174ff529-7467-4775-b06c-fe9426b83aff';
  v_marker text := 'FIX_SWAP_JUSTY:V-20260830152541402';

  v_sale public.sales%rowtype;
  v_item public.sale_items%rowtype;
  v_payment public.payments%rowtype;
  v_dura public.products%rowtype;
  v_manz public.products%rowtype;
  v_vault public.store_vaults%rowtype;

  v_rate numeric(14,4);
  v_old_unit_price_ref numeric(12,2);
  v_new_unit_price_ref numeric(12,2);
  v_new_unit_cost_ref numeric(12,2);
  v_old_line_ref numeric(14,2);
  v_new_line_ref numeric(14,2);
  v_delta_ref numeric(14,2);
  v_delta_ves numeric(14,2);
  v_new_line_subtotal_ves numeric(14,2);
  v_new_subtotal_ref numeric(14,2);
  v_new_total_ref numeric(14,2);
  v_new_total_ves numeric(14,2);
  v_new_amount_ref numeric(14,2);
  v_old_total_ref numeric(14,2);
  v_old_total_ves numeric(14,2);
  v_dura_old_stock integer;
  v_dura_new_stock integer;
  v_manz_old_stock integer;
  v_manz_new_stock integer;
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
      and reason like v_marker || '%'
  ) then
    raise notice 'Correccion % ya aplicada; no se repite.', v_marker;
    return;
  end if;

  select * into v_item
  from public.sale_items
  where id = v_item_id
    and sale_id = v_sale_id
    and product_id = v_dura_id
  for update;

  if not found then
    raise exception 'Linea just-dura-400-ml no encontrada en la venta';
  end if;

  if v_item.quantity <> 1 then
    raise exception 'Cantidad Justy Durazno inesperada: % (esperaba 1)', v_item.quantity;
  end if;

  select * into v_dura
  from public.products
  where id = v_dura_id
    and sku = 'just-dura-400-ml'
  for update;

  if not found then
    raise exception 'Producto just-dura-400-ml no encontrado';
  end if;

  select * into v_manz
  from public.products
  where id = v_manz_id
    and sku = 'just-manz-15-lt'
  for update;

  if not found then
    raise exception 'Producto just-manz-15-lt no encontrado';
  end if;

  if v_manz.current_stock < 1 then
    raise exception 'Stock insuficiente just-manz-15-lt: % (necesita >= 1)',
      v_manz.current_stock;
  end if;

  v_rate := v_sale.ref_rate_ves;
  if v_rate is null or v_rate <= 0 then
    raise exception 'Venta sin tasa ref_rate_ves valida';
  end if;

  v_old_unit_price_ref := v_item.unit_price_ref;
  v_new_unit_price_ref := v_manz.sale_price_ref;
  v_new_unit_cost_ref := v_manz.current_cost_ref;
  v_old_line_ref := round(v_item.quantity::numeric * v_old_unit_price_ref, 2);
  v_new_line_ref := round(v_item.quantity::numeric * v_new_unit_price_ref, 2);
  v_delta_ref := round(v_new_line_ref - v_old_line_ref, 2);
  v_new_line_subtotal_ves := round(v_new_line_ref * v_rate, 2);

  v_old_total_ref := v_sale.total_ref;
  v_old_total_ves := v_sale.total_ves;
  v_new_subtotal_ref := round(v_sale.subtotal_ref + v_delta_ref, 2);
  v_new_total_ref := greatest(
    round(v_new_subtotal_ref - coalesce(v_sale.discount_ref, 0) + coalesce(v_sale.tax_ref, 0), 2),
    0
  );
  v_new_total_ves := round(v_new_total_ref * v_rate, 2);
  v_delta_ves := round(v_new_total_ves - v_old_total_ves, 2);
  v_new_amount_ref := round(v_new_total_ves / v_rate, 2);

  v_dura_old_stock := v_dura.current_stock;
  v_dura_new_stock := v_dura_old_stock + 1;
  v_manz_old_stock := v_manz.current_stock;
  v_manz_new_stock := v_manz_old_stock - 1;

  update public.sale_items
  set product_id = v_manz_id,
      unit_price_ref = v_new_unit_price_ref,
      unit_cost_ref_snapshot = v_new_unit_cost_ref,
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
        v_marker || ' dura→manz 1.5lt',
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
        v_marker || ' monto ' ||
        case when v_delta_ves >= 0 then '+' else '' end || v_delta_ves::text
  where id = v_payment_id;

  update public.cash_movements
  set amount_ves = v_new_total_ves,
      notes = coalesce(notes, '') ||
        case when notes is null or btrim(notes) = '' then '' else ' | ' end ||
        v_marker || ' monto ' ||
        case when v_delta_ves >= 0 then '+' else '' end || v_delta_ves::text
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
        v_marker || ' monto ' ||
        case when v_delta_ves >= 0 then '+' else '' end || v_delta_ves::text
  where id = v_vault_movement_id
    and payment_id = v_payment_id
    and type = 'sale_in'
    and bucket = 'cuenta';

  if not found then
    raise exception 'vault_movement sale_in cuenta no encontrado';
  end if;

  select * into v_vault
  from public.store_vaults
  where id = v_vault_id
    and store_id = v_sale.store_id
  for update;

  if not found then
    raise exception 'store_vault no encontrado';
  end if;

  if v_delta_ves < 0 and v_vault.balance_ves < abs(v_delta_ves) then
    raise exception 'Saldo baul insuficiente para delta % (balance=%)',
      v_delta_ves, v_vault.balance_ves;
  end if;

  update public.store_vaults
  set balance_ves = balance_ves + v_delta_ves,
      updated_at = now()
  where id = v_vault.id;

  -- Restock Durazno (+1)
  insert into public.stock_movements (
    product_id, type, quantity_delta, stock_after, sale_id, purchase_id,
    reason, created_by, store_id
  ) values (
    v_dura_id,
    'ajuste_entrada',
    1,
    v_dura_new_stock,
    v_sale_id,
    null,
    v_marker || ' restock just-dura-400-ml (swap→manz)',
    v_sale.user_id,
    v_sale.store_id
  );

  update public.products
  set current_stock = v_dura_new_stock,
      updated_at = now()
  where id = v_dura_id;

  -- Venta Manzana (−1)
  insert into public.stock_movements (
    product_id, type, quantity_delta, stock_after, sale_id, purchase_id,
    reason, created_by, store_id
  ) values (
    v_manz_id,
    'venta',
    -1,
    v_manz_new_stock,
    v_sale_id,
    null,
    v_marker || ' Venta ' || v_sale.invoice_number || ' just-manz-15-lt',
    v_sale.user_id,
    v_sale.store_id
  );

  update public.products
  set current_stock = v_manz_new_stock,
      updated_at = now()
  where id = v_manz_id;

  raise notice
    'OK %: dura→manz line_ref %→%, total_ref %→%, total_ves %→%, pago_delta_ves %, stock dura %→%, manz %→%',
    v_sale.invoice_number,
    v_old_line_ref,
    v_new_line_ref,
    v_old_total_ref,
    v_new_total_ref,
    v_old_total_ves,
    v_new_total_ves,
    v_delta_ves,
    v_dura_old_stock,
    v_dura_new_stock,
    v_manz_old_stock,
    v_manz_new_stock;
end;
$$;
