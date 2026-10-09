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
-- -> verify. En el primer verify quedan en fail, y solo ellas, las dos filas que
-- exigen este parche: la de privilegios de 20261011d y la de RLS de
-- product_pack_components de 20261009d (que desde INV-L2 exige que authenticated
-- solo lea la tabla). En el segundo, fail = 0.
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
