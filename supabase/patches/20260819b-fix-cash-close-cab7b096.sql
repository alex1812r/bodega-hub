-- =============================================================================
-- 20260819b — Corregir cierre manual cab7b096 (contado solo ventas del dia)
-- One-shot. El cajero declaro solo efectivo de ventas (2666.30 / 2.00) y omitio
-- el fondo de apertura (5778.77 / 15.32). Teorico correcto = 8445.07 / 17.32.
-- Idempotente: solo actualiza si siguen los montos incorrectos.
-- =============================================================================

update public.cash_sessions
set
  closing_ves = theoretical_closing_ves,
  closing_ref = theoretical_closing_ref
where id = 'cab7b096-300a-4069-978e-ed6a9116eee2'
  and status = 'closed'
  and closed_reason = 'manual'
  and closing_ves = 2666.30
  and closing_ref = 2.00
  and theoretical_closing_ves = 8445.07
  and theoretical_closing_ref = 17.32;
