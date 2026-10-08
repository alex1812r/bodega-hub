import { z } from "zod";

import { ApiError } from "@/lib/api/apiError";

/** Tope del % de ganancia sugerido (check `categories_default_markup_pct_check`, parche 20261009b). */
export const CATEGORY_MARKUP_PCT_MAX = 1000;

export const CATEGORY_MARKUP_PCT_RANGE_MESSAGE = `El % de ganancia sugerido debe ser mayor que 0 y como máximo ${CATEGORY_MARKUP_PCT_MAX} %.`;

/** La columna es `numeric(6,2)`: dos decimales. */
function normalizeMarkupPct(pct: number) {
  return Math.round(pct * 100) / 100;
}

/**
 * % de ganancia sugerido de la categoría: número > 0 y ≤ 1000 (a dos decimales,
 * como lo guarda la base) o `null` para borrarlo. Se redondea antes de comprobar
 * el rango: 0,004 es 0 y se rechaza.
 */
export const categoryDefaultMarkupPctSchema = z
  .number(CATEGORY_MARKUP_PCT_RANGE_MESSAGE)
  .transform(normalizeMarkupPct)
  .refine((pct) => pct > 0 && pct <= CATEGORY_MARKUP_PCT_MAX, CATEGORY_MARKUP_PCT_RANGE_MESSAGE)
  .nullable();

/** Cuerpo de `POST /api/categories`. */
export const createCategorySchema = z.object({
  defaultMarkupPct: categoryDefaultMarkupPctSchema.optional(),
  description: z.string().optional(),
  name: z.string().min(1),
  taxRate: z.number().min(0).max(100).optional(),
});

/** Cuerpo de `PATCH /api/categories/{id}`. */
export const updateCategorySchema = z.object({
  defaultMarkupPct: categoryDefaultMarkupPctSchema.optional(),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
  name: z.string().min(1).optional(),
  taxRate: z.number().min(0).max(100).optional(),
});

/**
 * Valida el % sugerido en los servicios (real y mock, que no tiene el check de
 * la base): `undefined` si no viene, `null` si se borra, o el número a dos
 * decimales. Fuera de rango responde 400 con el motivo en español.
 */
export function parseCategoryDefaultMarkupPct(value: unknown): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = categoryDefaultMarkupPctSchema.safeParse(value);

  if (!parsed.success) {
    throw new ApiError(400, "BAD_REQUEST", CATEGORY_MARKUP_PCT_RANGE_MESSAGE);
  }

  return parsed.data;
}
