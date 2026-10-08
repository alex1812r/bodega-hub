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
