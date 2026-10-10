import { roundMoney } from "@bodega/core";

import { ApiError } from "@/lib/api/apiError";

/**
 * Regla única del descuento de una venta nueva (`discountRef`), antes del RPC.
 *
 * - Forma: lo que `create_sale` ya rechaza (no finito, negativo) o redondea en
 *   silencio (`sales.discount_ref` es `numeric(14,2)`) se rechaza aquí con 400.
 * - Rol: el POS no ofrece descuento (`PosCartItem` no lo modela) y `create_sale`
 *   impide al vendedor bajar del precio de lista (C19). Sin esta guarda, un
 *   vendedor por API vendía con `discountRef = subtotal − 0,01` (P4-2): el
 *   vendedor no aplica descuentos, igual que en la pantalla.
 *
 * El tope «descuento < subtotal» necesita los precios de lista y vive en el RPC.
 */
export const SALE_DISCOUNT_INVALID_MESSAGE = "El descuento debe ser un número válido.";
export const SALE_DISCOUNT_NEGATIVE_MESSAGE = "El descuento no puede ser negativo.";
export const SALE_DISCOUNT_DECIMALS_MESSAGE = "El descuento admite como máximo 2 decimales.";
export const SALE_DISCOUNT_FORBIDDEN_MESSAGE =
  "Tu rol no puede aplicar descuentos a una venta. Pide a un administrador que la registre.";

/** Roles a los que `create_sale` limita el precio (C19) y que no descuentan. */
const ROLES_WITHOUT_SALE_DISCOUNT: readonly string[] = ["vendedor"];

export function canApplySaleDiscount(role: string | undefined) {
  return role !== undefined && !ROLES_WITHOUT_SALE_DISCOUNT.includes(role);
}

/** Lanza `ApiError` 400 (forma) o 403 (rol) si el descuento no se puede enviar al RPC. */
export function assertSaleDiscountAllowed(discountRef: number, role: string | undefined) {
  if (!Number.isFinite(discountRef)) {
    throw new ApiError(400, "BAD_REQUEST", SALE_DISCOUNT_INVALID_MESSAGE);
  }

  if (discountRef < 0) {
    throw new ApiError(400, "BAD_REQUEST", SALE_DISCOUNT_NEGATIVE_MESSAGE);
  }

  if (roundMoney(discountRef) !== discountRef) {
    throw new ApiError(400, "BAD_REQUEST", SALE_DISCOUNT_DECIMALS_MESSAGE);
  }

  if (discountRef > 0 && !canApplySaleDiscount(role)) {
    throw new ApiError(403, "FORBIDDEN", SALE_DISCOUNT_FORBIDDEN_MESSAGE);
  }
}
