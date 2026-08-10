-- =============================================================================
-- 20260811a — enum stock_movement_type: conversion_salida / conversion_entrada
-- Ejecutar en un Run SEPARADO antes de 20260811-pack-unit-conversion.sql
-- (PostgreSQL no permite usar un valor de enum nuevo en la misma transaccion)
-- =============================================================================

alter type public.stock_movement_type add value if not exists 'conversion_salida';
alter type public.stock_movement_type add value if not exists 'conversion_entrada';
