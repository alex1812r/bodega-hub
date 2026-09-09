-- Patch: venta y cobro en una sola transaccion + clave de idempotencia
-- Fecha: 2026-09-09
-- Requiere: 20260904c-sale-integrity.sql (create_sale) y 20260904-payment-guards.sql
--           (register_payment con vuelto y desglose de billetes)
--
-- Problema: el POS hacia `create_sale` y despues uno o mas `register_payment` en
--   peticiones separadas. Cuando el cobro fallaba, la venta ya existia en
--   `pendiente_pago` con el inventario descargado; el cajero reintentaba y creaba
--   otra venta (29-ago-2026: cinco ventas identicas sin pago en seis minutos, que
--   hubo que cancelar a mano). La app parcheo el sintoma anulando la venta cuando
--   falla el cobro, pero seguian siendo dos transacciones y un corte de red entre
--   ambas dejaba la venta viva.
--
-- Solucion:
--   1. `create_sale_with_payments`: llama a `create_sale` y despues a
--      `register_payment` por cada linea recibida, todo dentro de la misma
--      transaccion. Si cualquier cobro falla (saldo, vuelto, caja cerrada...) se
--      revierte tambien la venta y el descuento de stock: o queda todo o no queda
--      nada. Reutiliza los RPC existentes a proposito: toda la validacion de
--      ventas y cobros sigue viviendo en un solo sitio.
--   2. `sales.client_request_id`: clave que genera el POS por intento de cobro.
--      Si el servidor registro la venta pero la respuesta se perdio, el reintento
--      con la misma clave devuelve la venta ya creada en vez de duplicarla. Unica
--      por tienda; nula para ventas de clientes que no la manden (app movil,
--      scripts), que conservan el comportamiento anterior.
--
-- Uso: Supabase Dashboard -> SQL Editor -> Run este archivo completo.
-- Idempotente: `add column if not exists`, `create index if not exists`,
-- `create or replace function` + `grant`.

-- =============================================================================
-- sales.client_request_id
-- =============================================================================
alter table public.sales
  add column if not exists client_request_id uuid;

comment on column public.sales.client_request_id is
  'Clave de idempotencia que manda el POS por intento de cobro. Reintentar con la misma clave devuelve la venta ya creada.';

create unique index if not exists sales_store_client_request_unique
  on public.sales (store_id, client_request_id)
  where client_request_id is not null;

-- =============================================================================
-- create_sale_with_payments
-- =============================================================================
create or replace function public.create_sale_with_payments(
  p_customer_id uuid,
  p_items jsonb,
  p_payments jsonb default '[]'::jsonb,
  p_exchange_rate_id uuid default null,
  p_ref_rate_ves numeric default null,
  p_discount_ref numeric default 0,
  p_tax_ref numeric default 0,
  p_notes text default null,
  p_invoice_number text default null,
  p_client_request_id uuid default null
)
returns public.sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_sale public.sales;
  v_payment jsonb;
  v_change_amount numeric;
begin
  v_store_id := public.assert_store_context();

  -- Reintento del mismo intento de cobro: la venta ya quedo registrada.
  if p_client_request_id is not null then
    select * into v_sale
    from public.sales
    where store_id = v_store_id
      and client_request_id = p_client_request_id;

    if found then
      return v_sale;
    end if;
  end if;

  if p_payments is not null and jsonb_typeof(p_payments) <> 'array' then
    raise exception 'Los pagos de la venta deben venir como lista' using errcode = 'PT400';
  end if;

  v_sale := public.create_sale(
    p_customer_id,
    p_items,
    p_exchange_rate_id,
    p_ref_rate_ves,
    p_discount_ref,
    p_tax_ref,
    p_notes,
    p_invoice_number
  );

  if p_client_request_id is not null then
    update public.sales
    set client_request_id = p_client_request_id
    where id = v_sale.id;
  end if;

  for v_payment in select * from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb))
  loop
    v_change_amount := coalesce((v_payment ->> 'change_amount')::numeric, 0);

    -- Cualquier excepcion aqui (saldo, vuelto, billetes, caja cerrada, permisos)
    -- aborta la funcion completa y Postgres revierte la venta y el stock.
    perform public.register_payment(
      p_sale_id => v_sale.id,
      p_purchase_id => null,
      p_method => (v_payment ->> 'method')::public.payment_method,
      p_amount => (v_payment ->> 'amount')::numeric,
      p_bank_name => v_payment ->> 'bank_name',
      p_phone => v_payment ->> 'phone',
      p_reference_code => v_payment ->> 'reference_code',
      p_notes => v_payment ->> 'notes',
      p_change_method => case
        when v_change_amount > 0 then (v_payment ->> 'change_method')::public.payment_method
        else null
      end,
      p_change_amount => v_change_amount,
      p_received_denominations => case
        when jsonb_typeof(v_payment -> 'received_denominations') = 'object'
          then v_payment -> 'received_denominations'
        else null
      end,
      p_change_denominations => case
        when jsonb_typeof(v_payment -> 'change_denominations') = 'object'
          then v_payment -> 'change_denominations'
        else null
      end
    );
  end loop;

  -- `register_payment` actualiza paid_ves y status: se relee la fila final.
  select * into v_sale
  from public.sales
  where id = v_sale.id;

  return v_sale;
end;
$$;

grant execute on function public.create_sale_with_payments(
  uuid, jsonb, jsonb, uuid, numeric, numeric, numeric, text, text, uuid
) to authenticated;
