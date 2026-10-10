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
 * El tope «descuento < subtotal» lo aplica el RPC solo al vendedor (C19). Para el
 * resto lo aplica `assertSaleDiscountBelowBodySubtotal` con el subtotal del
 * cuerpo, que es el del RPC (`create_sale` usa el `unit_price_ref` enviado en
 * todos los roles). Por eso un descuento exige el precio de cada línea: una línea
 * sin precio la valora el RPC con el de lista y el tope no se podría comprobar.
 */
export const SALE_DISCOUNT_INVALID_MESSAGE = "El descuento debe ser un número válido.";
export const SALE_DISCOUNT_NEGATIVE_MESSAGE = "El descuento no puede ser negativo.";
export const SALE_DISCOUNT_DECIMALS_MESSAGE = "El descuento admite como máximo 2 decimales.";
export const SALE_DISCOUNT_OVER_SUBTOTAL_MESSAGE =
  "El descuento no puede ser igual o mayor al subtotal de la venta.";
export const SALE_DISCOUNT_NEEDS_PRICES_MESSAGE =
  "Para aplicar un descuento indica el precio unitario de cada línea.";
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

type SaleBodyLine = { quantity: number; unitPriceRef?: number };

/**
 * Subtotal de la venta en céntimos tal como lo calcula `create_sale`
 * (`round(cantidad × precio, 2)` por línea), o `null` si alguna línea no trae
 * precio: ese lo pone el RPC con el precio de lista y aquí no se conoce.
 */
export function saleBodySubtotalCents(items: readonly SaleBodyLine[]) {
  let cents = 0;

  for (const item of items) {
    if (item.unitPriceRef === undefined) {
      return null;
    }

    cents += Math.round(roundMoney(item.quantity * roundMoney(item.unitPriceRef)) * 100);
  }

  return cents;
}

/**
 * Lanza `ApiError` 400 si el descuento iguala o supera el subtotal del cuerpo
 * (POS-F3 / caos F5: venta en 0,00 con `discount_ref > subtotal_ref`), o si hay
 * descuento y alguna línea no trae precio (POS-F4: bastaba omitir uno para
 * saltarse el tope). Sin descuento no exige nada. No lee la base: no añade nada
 * al camino de cobro.
 */
export function assertSaleDiscountBelowBodySubtotal(
  discountRef: number,
  items: readonly SaleBodyLine[],
) {
  if (discountRef <= 0) {
    return;
  }

  const subtotalCents = saleBodySubtotalCents(items);

  if (subtotalCents === null) {
    throw new ApiError(400, "BAD_REQUEST", SALE_DISCOUNT_NEEDS_PRICES_MESSAGE);
  }

  if (Math.round(discountRef * 100) >= subtotalCents) {
    throw new ApiError(400, "BAD_REQUEST", SALE_DISCOUNT_OVER_SUBTOTAL_MESSAGE);
  }
}
