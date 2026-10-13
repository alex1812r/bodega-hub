-- =============================================================================
-- 20261007b — cambio atomico de una alicuota de IVA para la tienda (SHR-10)
-- Proyecto: BodegaHub (plan ux-mejoras, Ola 0)
-- Requiere: 20261007a-tax-rates.sql (tabla tax_rates, tax_rates_for_store y los
--           triggers de sincronizacion de categories / app_settings).
--
--   public.override_tax_rate_for_store(p_tax_rate_id, p_label, p_pct,
--                                      p_is_active, p_sort_order)
--
--   Unico camino del BFF (PATCH /api/tax-rates/{id}) para cambiar una alicuota.
--   Cada parametro en NULL deja el valor como esta. Todo ocurre en UNA
--   transaccion: o queda aplicado entero o no cambia nada.
--     * Alicuota propia de la tienda -> se actualiza.
--     * Alicuota global -> las globales no se escriben: la tienda recibe su
--       propia fila con el mismo code (copia de la global) y sobre ella se
--       aplica el cambio. Si otra transaccion la creo a la vez, se reutiliza
--       (no se duplica). Un cambio que no cambia nada de una global no crea fila.
--     * En los dos casos, las categories.tax_rate_id y el
--       app_settings.default_tax_rate_id de ESA tienda que apuntaban a la global
--       del mismo code pasan a la fila de la tienda (los triggers de 20261007a
--       copian el porcentaje).
--   Rechazos:
--     * 42501 sin tienda activa (assert_store_context); PT403 si el rol no es admin.
--     * PT400: label vacio, pct fuera de 0..100 o no finito, sort_order negativo.
--     * PT404: la alicuota no existe para la tienda (id inexistente, de otra
--       tienda, o global que la tienda ya redefinio: su fila propia es la vigente).
--     * PT409: desactivar una alicuota que usan categorias activas de la tienda
--       o que es su alicuota por defecto. Mismo texto que
--       buildTaxRateInUseMessage (src/modules/settings/services/taxRates.schemas.ts).
--   Bloqueos, siempre en este orden: la alicuota (for update), las categorias
--   de la tienda que la usan (order by id) y la fila de app_settings.
--   No toca purchase_items (su tax_rate es snapshot), stock ni dinero.
--
-- Idempotente (create or replace), una sola transaccion. No migra ni toca filas.
-- Ejecutar en SQL Editor o via db-up, despues de 20261007a.
-- =============================================================================

begin;

create or replace function public.override_tax_rate_for_store(
  p_tax_rate_id uuid,
  p_label text default null,
  p_pct numeric default null,
  p_is_active boolean default null,
  p_sort_order integer default null
)
returns public.tax_rates
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_rate public.tax_rates;
  v_global_id uuid;
  v_label text;
  v_pct numeric(5,2);
  v_is_active boolean;
  v_sort_order integer;
  v_active_categories integer;
  v_is_default boolean;
  v_usage text;
  v_prefix text;
begin
  v_store_id := public.assert_store_context();

  if coalesce(public.current_user_role()::text, '') <> 'admin' then
    raise exception using errcode = 'PT403', message = 'No autorizado para modificar alicuotas de IVA';
  end if;

  if p_tax_rate_id is null then
    raise exception using errcode = 'PT400', message = 'La alicuota de IVA es obligatoria';
  end if;

  if p_label is not null and btrim(p_label) = '' then
    raise exception using errcode = 'PT400', message = 'El nombre de la alicuota es obligatorio.';
  end if;

  -- (x - x) <> 0 detecta NaN e Infinity sin literales (igual que 20261006i).
  if p_pct is not null and ((p_pct - p_pct) <> 0 or p_pct < 0 or p_pct > 100) then
    raise exception using errcode = 'PT400', message = 'El porcentaje debe estar entre 0 y 100.';
  end if;

  if p_sort_order is not null and p_sort_order < 0 then
    raise exception using errcode = 'PT400', message = 'El orden de la alicuota no puede ser negativo';
  end if;

  select * into v_rate
  from public.tax_rates t
  where t.id = p_tax_rate_id
    and (t.store_id is null or t.store_id = v_store_id);

  if not found then
    raise exception using errcode = 'PT404', message = 'Alicuota de IVA no encontrada.';
  end if;

  if v_rate.store_id is null then
    -- Global que la tienda ya redefinio: para ella no existe (tax_rates_for_store).
    if exists (
      select 1
      from public.tax_rates o
      where o.store_id = v_store_id
        and o.code = v_rate.code
    ) then
      raise exception using errcode = 'PT404', message = 'Alicuota de IVA no encontrada.';
    end if;

    if coalesce(btrim(p_label), v_rate.label) = v_rate.label
       and coalesce(p_pct::numeric(5,2), v_rate.pct) = v_rate.pct
       and coalesce(p_is_active, v_rate.is_active) = v_rate.is_active
       and coalesce(p_sort_order, v_rate.sort_order) = v_rate.sort_order then
      return v_rate;
    end if;

    v_global_id := v_rate.id;

    -- Copia de la global en la tienda. Si otra transaccion la crea a la vez,
    -- esta espera en el indice unico y reutiliza la fila ya creada.
    insert into public.tax_rates (store_id, code, label, pct, is_active, sort_order)
    values (v_store_id, v_rate.code, v_rate.label, v_rate.pct, v_rate.is_active, v_rate.sort_order)
    on conflict (store_id, code) where store_id is not null do nothing;

    select * into strict v_rate
    from public.tax_rates t
    where t.store_id = v_store_id
      and t.code = v_rate.code
    for update;
  else
    select * into strict v_rate
    from public.tax_rates t
    where t.id = p_tax_rate_id
    for update;

    select t.id into v_global_id
    from public.tax_rates t
    where t.store_id is null
      and t.code = v_rate.code;
  end if;

  perform 1
  from public.categories c
  where c.store_id = v_store_id
    and (c.tax_rate_id = v_rate.id or c.tax_rate_id = v_global_id)
  order by c.id
  for update;

  perform 1
  from public.app_settings s
  where s.store_id = v_store_id
  for update;

  -- La fila de la tienda manda sobre la global del mismo code: lo que en la
  -- tienda apuntaba a la global pasa a la fila propia.
  if v_global_id is not null then
    update public.categories
    set tax_rate_id = v_rate.id
    where store_id = v_store_id
      and tax_rate_id = v_global_id;

    update public.app_settings
    set default_tax_rate_id = v_rate.id
    where store_id = v_store_id
      and default_tax_rate_id = v_global_id;
  end if;

  v_label := coalesce(btrim(p_label), v_rate.label);
  v_pct := coalesce(p_pct, v_rate.pct);
  v_is_active := coalesce(p_is_active, v_rate.is_active);
  v_sort_order := coalesce(p_sort_order, v_rate.sort_order);

  if v_rate.is_active and not v_is_active then
    select count(*)::integer into v_active_categories
    from public.categories c
    where c.store_id = v_store_id
      and c.tax_rate_id = v_rate.id
      and c.is_active;

    v_is_default := exists (
      select 1
      from public.app_settings s
      where s.store_id = v_store_id
        and s.default_tax_rate_id = v_rate.id
    );

    if v_active_categories > 0 or v_is_default then
      v_prefix := 'No se puede desactivar la alicuota "' || v_rate.label || '": ';
      v_usage := case
        when v_active_categories = 1 then 'la usa 1 categoria activa'
        else 'la usan ' || v_active_categories || ' categorias activas'
      end;

      raise exception using
        errcode = 'PT409',
        message = case
          when v_active_categories > 0 and v_is_default then
            v_prefix || v_usage || ' y es la alicuota por defecto de la tienda. Reasigna esas categorias y elige otra por defecto antes de desactivarla.'
          when v_is_default then
            v_prefix || 'es la alicuota por defecto de la tienda (' || v_usage || '). Elige otra por defecto antes de desactivarla.'
          else
            v_prefix || v_usage || '. Reasignalas a otra alicuota antes de desactivarla.'
        end;
    end if;
  end if;

  update public.tax_rates
  set label = v_label,
      pct = v_pct,
      is_active = v_is_active,
      sort_order = v_sort_order
  where id = v_rate.id
  returning * into v_rate;

  return v_rate;
end;
$$;

comment on function public.override_tax_rate_for_store(uuid, text, numeric, boolean, integer) is
  'Cambia una alicuota de IVA para la tienda del usuario (admin) en una transaccion: actualiza la propia o crea la fila de la tienda a partir de la global y le traspasa categorias y alicuota por defecto.';

revoke all on function public.override_tax_rate_for_store(uuid, text, numeric, boolean, integer) from public, anon;
grant execute on function public.override_tax_rate_for_store(uuid, text, numeric, boolean, integer) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
