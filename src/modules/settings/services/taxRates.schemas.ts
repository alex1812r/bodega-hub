import { z } from "zod";

import { cleanText } from "@/modules/products/services/productText";

/** Mismo formato que el check `tax_rates_code_format` del parche 20261007a. */
export const TAX_RATE_CODE_PATTERN = /^[a-z0-9]+([.-][a-z0-9]+)*$/;
export const TAX_RATE_CODE_MAX_LENGTH = 40;

export const TAX_RATE_NOT_FOUND_MESSAGE = "Alicuota de IVA no encontrada.";
/** Rechazo (400) al elegir como alícuota por defecto una que la tienda no ve o que está inactiva. */
export const DEFAULT_TAX_RATE_UNAVAILABLE_MESSAGE =
  "La alícuota de IVA por defecto no existe o no está activa para esta tienda.";

/** Alicuota de IVA tal como la devuelve `/api/tax-rates`. */
export type TaxRate = {
  code: string;
  id: string;
  isActive: boolean;
  /** Es la alicuota por defecto de la tienda (`app_settings.default_tax_rate_id`). */
  isDefault: boolean;
  /** Semilla comun a todas las tiendas: al cambiarla la tienda recibe su propia copia. */
  isGlobal: boolean;
  label: string;
  pct: number;
  sortOrder: number;
};

export type TaxRateList = {
  items: TaxRate[];
};

export type TaxRateListFilters = {
  activeOnly?: boolean;
};

// Sin caracteres de control: Postgres rechaza el NUL en `text` y salía como 500.
const labelSchema = z
  .string()
  .transform(cleanText)
  .pipe(z.string().min(1, "El nombre de la alicuota es obligatorio.").max(60));
const pctSchema = z
  .number()
  .min(0, "El porcentaje debe estar entre 0 y 100.")
  .max(100, "El porcentaje debe estar entre 0 y 100.");

// Objetos estrictos: `storeId` (lo fija el servidor) o `code` en un cambio se
// rechazan con 400 en vez de ignorarse en silencio.
export const createTaxRateSchema = z.strictObject({
  code: z
    .string()
    .trim()
    .max(TAX_RATE_CODE_MAX_LENGTH)
    .regex(TAX_RATE_CODE_PATTERN, "El código solo admite minúsculas, números, guiones y puntos.")
    .optional(),
  label: labelSchema,
  pct: pctSchema,
});

export const updateTaxRateSchema = z
  .strictObject({
    isActive: z.boolean().optional(),
    label: labelSchema.optional(),
    pct: pctSchema.optional(),
    sortOrder: z.number().int().min(0).max(100000).optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: "Debes indicar al menos un cambio.",
  });

export type CreateTaxRateInput = z.infer<typeof createTaxRateSchema>;
export type UpdateTaxRateInput = z.infer<typeof updateTaxRateSchema>;

/** `pct` es `numeric(5,2)` en la base: dos decimales. */
export function normalizeTaxRatePct(pct: number) {
  return Math.round(pct * 100) / 100;
}

/** "General 12 %" -> "general-12". Devuelve "" si el nombre no deja ningun caracter util. */
export function buildTaxRateCode(label: string) {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, TAX_RATE_CODE_MAX_LENGTH)
    .replace(/-+$/, "");
}

export function compareTaxRates(
  first: Pick<TaxRate, "code" | "sortOrder">,
  second: Pick<TaxRate, "code" | "sortOrder">,
) {
  return first.sortOrder - second.sortOrder || first.code.localeCompare(second.code);
}

/** Siguiente `sortOrder` para una alicuota nueva: al final de las que ve la tienda. */
export function nextTaxRateSortOrder(rates: ReadonlyArray<Pick<TaxRate, "sortOrder">>) {
  return rates.reduce((max, rate) => Math.max(max, rate.sortOrder), 0) + 10;
}

export function buildTaxRateCodeTakenMessage(code: string) {
  return `Ya existe una alícuota de IVA con el código "${code}".`;
}

export const TAX_RATE_CODE_NOT_DERIVABLE_MESSAGE =
  "No se pudo generar un código a partir del nombre: usa letras o números.";

/**
 * Motivo por el que una alicuota no se puede desactivar, o `null` si nadie la usa.
 * El mock lo usa tal cual; en Supabase el rechazo lo redacta la RPC
 * `override_tax_rate_for_store` (parche 20261007b) con este mismo texto: si
 * cambia aqui, cambia alli (lo compara `scripts/stock-lab/regression/tax-rates.test.ts`).
 */
export function buildTaxRateInUseMessage(
  label: string,
  activeCategoriesCount: number,
  isDefault: boolean,
) {
  if (activeCategoriesCount <= 0 && !isDefault) {
    return null;
  }

  const categories =
    activeCategoriesCount === 1
      ? "la usa 1 categoria activa"
      : `la usan ${activeCategoriesCount} categorias activas`;
  const prefix = `No se puede desactivar la alicuota "${label}": `;

  if (activeCategoriesCount > 0 && isDefault) {
    return `${prefix}${categories} y es la alicuota por defecto de la tienda. Reasigna esas categorias y elige otra por defecto antes de desactivarla.`;
  }

  if (isDefault) {
    return `${prefix}es la alicuota por defecto de la tienda (${categories}). Elige otra por defecto antes de desactivarla.`;
  }

  return `${prefix}${categories}. Reasignalas a otra alicuota antes de desactivarla.`;
}
