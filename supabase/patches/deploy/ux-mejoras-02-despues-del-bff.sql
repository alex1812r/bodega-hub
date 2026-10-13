-- =============================================================================
-- ux-mejoras 02 — parches que van DESPUES de desplegar el BFF
-- Proyecto: BodegaHub · plan ux-mejoras
--
-- Que es: los 2 parches del plan ux-mejoras que solo se pueden aplicar con el BFF nuevo ya desplegado:
--   20261010c-payments-purchase-rls, 20261011d-pack-recipe-write-lockdown
--
-- NUNCA antes del BFF nuevo: el BFF anterior suma los pagos de una compra con la sesion del usuario (sobre
-- 20261010c, almacen veria "Pagado 0") y escribe la receta de empaque por tabla (sobre 20261011d recibiria 403).
--
-- Cuando se ejecuta (secuencia completa):
--   1. comprobaciones previas de docs/despliegue-ux-mejoras.md, seccion 1.
--   2. supabase/patches/deploy/ux-mejoras-01-antes-del-bff.sql.
--   3. supabase/patches/verify-patches.sql: en fail solo las 3 filas que exigen 20261010c y 20261011d.
--   4. desplegar el BFF.
--   5. ESTE ARCHIVO (02).
--   6. supabase/patches/verify-patches.sql: NINGUNA fila en fail.
--
-- Idempotente: cada parche lo es y va en su propia transaccion; se puede ejecutar otra vez y el verify queda igual.
--
-- Deshacer 20261011d (si hubiera que volver al BFF anterior):
--   grant insert, update, delete on public.product_pack_conversions, public.product_pack_components to authenticated;
--
-- Detalle: docs/despliegue-ux-mejoras.md, seccion 2 (pasos 25 y 26), y la cabecera de cada parche mas abajo.
--
-- ARCHIVO GENERADO por scripts/build-deploy-sql.mjs (npm run deploy:sql). NO editarlo a mano: se cambia el parche
-- en supabase/patches/ (o la lista del script) y se regenera. Los parches van tal cual, uno tras otro, cada uno
-- precedido de una linea `-- ===== <archivo> =====`.
-- =============================================================================

-- ===== 20261010c-payments-purchase-rls.sql =====
-- =============================================================================
-- 20261010c — los pagos de COMPRAS solo los leen admin y contador
--             (COM-16; plan ux-mejoras, Ola 1; decision D23)
-- Proyecto: BodegaHub
-- Requiere: 20260716-multi-store (payments.store_id, current_user_store_id) y
--           20261006a / 20261006h (insert y delete directos revocados, update
--           de metadatos solo admin / contador).
--
-- REDEFINE una sola politica: "Authenticated users read payments" (SELECT de
-- public.payments). No toca tablas, columnas, indices, funciones, triggers ni
-- ninguna otra politica. No migra datos.
--
--   1. Hasta hoy la lectura era "store_id = current_user_store_id()" para
--      cualquier rol: vendedor y almacen podian leer por PostgREST, con su JWT,
--      los pagos a proveedores (monto, banco, referencia), aunque el BFF se los
--      niega (vendedor: solo pagos de ventas; almacen: sin payments.view).
--   2. Desde aqui una fila de pago de compra (purchase_id is not null; el check
--      de la tabla la hace equivalente a direction = 'salida') solo la leen los
--      roles con permiso de pagos de compras: admin y contador. Los pagos de
--      ventas (purchase_id is null) se leen como hasta hoy: todo usuario de la
--      tienda.
--   3. Las RPC que leen payments (register_payment, cancel_payment, cierre de
--      caja, baul, vistas de integridad) son security definer: no dependen de
--      esta politica y no cambian.
--   4. Lo pagado de una compra sigue legible para quien lee la compra, desde su
--      cabecera: purchases.paid_ref / paid_ves, que mantiene register_payment.
--   5. Tablas hijas de payments: cash_movements solo guarda cobros y reintegros
--      de VENTAS (sale_in, refund_out) y se lee por sesion propia: no expone
--      pagos de compras. vault_movements (purchase_out) es baul y NO se toca
--      aqui (hallazgo aparte).
--
-- Idempotente, una transaccion. NO se aplica a produccion desde este plan.
-- Reaplicar 20260716-multi-store reinstala la lectura por tienda sin filtro de
-- rol: volver a aplicar este parche despues.
-- =============================================================================

begin;

drop policy if exists "Authenticated users read payments" on public.payments;
create policy "Authenticated users read payments"
on public.payments for select
to authenticated
using (
  store_id = public.current_user_store_id()
  and (
    purchase_id is null
    or public.current_user_role() in ('admin', 'contador')
  )
);

commit;

notify pgrst, 'reload schema';

-- ===== 20261011d-pack-recipe-write-lockdown.sql =====
-- =============================================================================
-- 20261011d — la receta de un empaque solo se escribe por save_pack_recipe
--             (INV-L2; plan ux-mejoras; cierra el riesgo residual de 20261011c)
-- Proyecto: BodegaHub
-- Requiere: 20261009d (product_pack_components) y 20261011c (save_pack_recipe).
--
-- 20261011c dejo la regla de cadenas y el bloqueo ordenado de productos dentro
-- de la RPC, pero authenticated conservaba insert / update / delete sobre
-- product_pack_conversions y product_pack_components (RLS admin / almacen de la
-- tienda). Con el JWT de un admin o de almacen, un POST directo a
-- /rest/v1/product_pack_conversions dejaba la cadena A -> B -> C sin tomar el
-- bloqueo ni pasar la regla; PATCH y DELETE tambien entraban (caos Inventario,
-- pasada 2, M1). Ademas anon tenia TODOS los privilegios de tabla sobre
-- product_pack_conversions (los privilegios por defecto de Supabase; la RLS no
-- le dejaba ver ni escribir filas, pero el privilegio no debia existir).
--
-- Que hace: solo privilegios de tabla.
--   * anon, public: ninguno en las dos tablas.
--   * authenticated: SOLO select en las dos tablas (lo que lee la app: recetas,
--     pack_role, product_pack_roles, conversion_mismatches, inventory_overview).
--   * service_role: todos (igual que hasta ahora).
--   * postgres (dueno de las tablas): no cambia. Migraciones y fixtures siguen
--     escribiendo por conexion directa.
--
-- Que NO cambia: las politicas RLS (lectura por tienda; las de escritura admin /
-- almacen quedan sin efecto para authenticated al no tener el privilegio, y se
-- conservan), los triggers de las dos tablas, save_pack_recipe y
-- convert_pack_to_units. save_pack_recipe es security definer y su dueno es el
-- dueno de las tablas: sigue guardando, reemplazando y desactivando. Los
-- triggers que mantienen cabecera y componentes al dia tambien son security
-- definer.
--
-- Por que revocar y no un trigger de respaldo: ver la cabecera de 20261011c
-- (sin el bloqueo ordenado un trigger no cierra la carrera, tomarlo fila a fila
-- rompe el orden de bloqueo de las demas RPC y los datos anteriores a la regla
-- obligarian a una via de escape). Ningun codigo del BFF escribe estas tablas
-- fuera de la RPC desde INV-09.
--
-- ORDEN DE DESPLIEGUE: 20261011c -> verify -> BFF nuevo (INV-09) -> este parche
-- -> verify. En el primer verify quedan en fail las dos filas que exigen este
-- parche: la de privilegios de 20261011d y la de RLS de product_pack_components
-- de 20261009d (que desde INV-L2 exige que authenticated solo lea la tabla). En
-- el despliegue de ux-mejoras 20261010c tambien va despues del BFF, asi que en
-- ese primer verify son TRES, y solo esas: las dos de arriba y la de la politica
-- de lectura de payments de 20261010c (docs/despliegue-ux-mejoras.md, seccion 2).
-- En el segundo, fail = 0.
-- El BFF ANTERIOR a INV-09 escribe la receta por tabla: sobre una base con este
-- parche, guardar, editar o desactivar la receta de un empaque le responde 403
-- (permission denied). No aplicar antes de desplegar el BFF que usa la RPC.
--
-- Reaplicar 20261009d devuelve a authenticated insert / update / delete sobre
-- product_pack_components (su seccion de grants): volver a aplicar este parche
-- justo despues (verify-patches.sql lo marca en fail en esas mismas dos filas).
--
-- Deshacer (si hubiera que volver al BFF anterior):
--   grant insert, update, delete on public.product_pack_conversions,
--     public.product_pack_components to authenticated;
--
-- Idempotente, una sola transaccion. Ejecutar en SQL Editor o via db-up.
-- NO aplicado a produccion.
-- =============================================================================

begin;

revoke all on public.product_pack_conversions from public, anon, authenticated;
revoke all on public.product_pack_components from public, anon, authenticated;

grant select on public.product_pack_conversions to authenticated;
grant select on public.product_pack_components to authenticated;

grant all on public.product_pack_conversions to service_role;
grant all on public.product_pack_components to service_role;

commit;

notify pgrst, 'reload schema';
