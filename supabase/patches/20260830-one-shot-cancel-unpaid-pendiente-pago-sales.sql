-- =============================================================================
-- 20260830 — One-shot: cancelar ventas pendiente_pago sin pago (paid_ves=0)
--
-- ÁMBITO: SOLO ventas (sales). NO toca compras / purchase_* / vault purchase_out.
--
-- Hallazgo prod (2026-08-30): 6 ventas pendiente_pago, todas paid_ves=0,
-- sin pagos activos, cliente "Consumidor final", store 7c11edd5-...
--
--   V-20260829193033896  just-manz-15-lt x1
--   V-20260829193157661  just-manz-15-lt x1
--   V-20260829193425792  cerv-pola-lata-250m x3
--   V-20260829193529651  cerv-pola-lata-250m x3
--   V-20260829193647610  cerv-pola-lata-250m x3
--   V-20260829194058957  cerv-pola-lata-250m x3
--
-- Acción (equivalente a cancel_sale): status → cancelada + restock via
-- stock_movements tipo ajuste_entrada (reason con marker).
-- Idempotente: si ya cancelada con movimiento Cancelacion+marker, no repite.
-- =============================================================================

do $$
declare
  v_marker text := 'ONESHOT_CANCEL_PENDIENTE_PAGO_20260830';
  v_sale_ids uuid[] := array[
    'f4027454-8737-4136-9d67-5f0ffa00d8ad'::uuid,
    '0fa60229-121d-4e99-884b-665a59f73f01'::uuid,
    '6933d498-3aec-4e42-94c4-64ac8ea0788c'::uuid,
    '4b8d95d6-c903-48f2-a612-de4ebd2967c4'::uuid,
    'e7490618-8d6d-43d1-ab96-b0981c2db6e7'::uuid,
    '761e9351-053f-4888-b8f0-816793b0458a'::uuid
  ];
  v_sale public.sales%rowtype;
  v_item public.sale_items%rowtype;
  v_product public.products%rowtype;
  v_stock_after integer;
  v_cancelled int := 0;
  v_skipped int := 0;
begin
  -- Seguridad: abortar si alguna tiene pago parcial
  if exists (
    select 1 from public.sales
    where id = any(v_sale_ids)
      and coalesce(paid_ves, 0) > 0
  ) then
    raise exception
      'Abortado: hay ventas objetivo con paid_ves > 0. Revisar pagos antes de cancelar.';
  end if;

  if exists (
    select 1
    from public.payments p
    where p.sale_id = any(v_sale_ids)
      and p.status = 'activo'
      and coalesce(p.amount_ves, 0) > 0
  ) then
    raise exception
      'Abortado: hay payments activos ligados a ventas objetivo.';
  end if;

  for v_sale in
    select * from public.sales
    where id = any(v_sale_ids)
    order by created_at
    for update
  loop
    if v_sale.status = 'cancelada'
       and exists (
         select 1 from public.stock_movements sm
         where sm.sale_id = v_sale.id
           and sm.type = 'ajuste_entrada'
           and sm.reason like '%' || v_marker || '%'
       )
    then
      v_skipped := v_skipped + 1;
      raise notice 'Venta % ya cancelada con marker; skip.', v_sale.invoice_number;
      continue;
    end if;

    if v_sale.status not in ('pendiente_pago', 'borrador') then
      raise exception 'Venta % en estado inesperado: %',
        v_sale.invoice_number, v_sale.status;
    end if;

    if coalesce(v_sale.paid_ves, 0) <> 0 then
      raise exception 'Venta % tiene paid_ves=%', v_sale.invoice_number, v_sale.paid_ves;
    end if;

    for v_item in
      select * from public.sale_items where sale_id = v_sale.id
    loop
      if exists (
        select 1 from public.stock_movements sm
        where sm.sale_id = v_sale.id
          and sm.product_id = v_item.product_id
          and sm.type = 'ajuste_entrada'
          and sm.reason like '%' || v_marker || '%'
      ) then
        continue;
      end if;

      select * into v_product
      from public.products
      where id = v_item.product_id
        and store_id = v_sale.store_id
      for update;

      if not found then
        raise exception 'Producto % no encontrado para venta %',
          v_item.product_id, v_sale.invoice_number;
      end if;

      v_stock_after := v_product.current_stock + v_item.quantity;

      update public.products
      set current_stock = v_stock_after
      where id = v_product.id;

      insert into public.stock_movements (
        product_id,
        type,
        quantity_delta,
        stock_after,
        sale_id,
        reason,
        created_by,
        store_id
      ) values (
        v_item.product_id,
        'ajuste_entrada',
        v_item.quantity,
        v_stock_after,
        v_sale.id,
        'Cancelacion ' || v_sale.invoice_number || ' [' || v_marker || ']',
        v_sale.user_id,
        v_sale.store_id
      );
    end loop;

    update public.sales
    set status = 'cancelada'
    where id = v_sale.id;

    v_cancelled := v_cancelled + 1;
    raise notice 'Cancelada venta % (restock ok).', v_sale.invoice_number;
  end loop;

  raise notice 'ONESHOT % done. cancelled=% skipped=% (purchases untouched).',
    v_marker, v_cancelled, v_skipped;
end;
$$;
