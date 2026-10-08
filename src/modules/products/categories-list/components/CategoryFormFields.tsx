"use client";

import { useState } from "react";

import { Input } from "@/shared/components/Input";
import { TaxRateChips } from "@/shared/components/TaxRateChips";
import { Textarea } from "@/shared/components/Textarea";
import { type TaxRate, useTaxRates } from "@/shared/hooks/useTaxRates";
import type { CategoryMock } from "@/shared/mocks/erp-data";
import { formHelperClassName, formLabelClassName } from "@/shared/styles/form-controls";

import type { CategoryInput } from "../../hooks/useProducts";

/** Porcentaje con el que el servidor crea una categoría que no indica alícuota. */
const FALLBACK_TAX_RATE_PCT = 16;
const TAX_RATE_FIELD_NAME = "taxRate";

type TaxRateSelection = { code: string; pct: number };

type CategoryFormFieldsProps = {
  /** Categoría en edición. Sin ella los campos abren como un alta. */
  category?: CategoryMock;
  /** Error del servidor; se muestra al pie de los campos. */
  errorMessage?: string;
  /** El alta rápida desde el producto solo pide Nombre y alícuota. */
  showDescription?: boolean;
};

/**
 * Alícuota con la que abre el campo. Edición: la de la categoría, aunque esté
 * desactivada o ya no exista en el catálogo (código `otro-<pct>`, que
 * `TaxRateChips` muestra con su porcentaje). Alta: la alícuota por defecto de
 * la tienda y, si no hay ninguna activa marcada, la del 16 %.
 */
function resolveInitialSelection(
  category: CategoryMock | undefined,
  rates: TaxRate[],
  byPct: (pct: number) => TaxRate | null,
): TaxRateSelection | null {
  if (category) {
    const rate =
      rates.find((item) => item.id === category.taxRateId) ?? byPct(category.taxRate);

    return { code: rate?.code ?? `otro-${category.taxRate}`, pct: category.taxRate };
  }

  const fallback = byPct(FALLBACK_TAX_RATE_PCT);
  const rate =
    rates.find((item) => item.isDefault && item.isActive) ??
    (fallback?.isActive ? fallback : null);

  return rate ? { code: rate.code, pct: rate.pct } : null;
}

/**
 * Campos de una categoría: Nombre, alícuota de IVA y, salvo en el alta rápida,
 * Descripción. Los usan `CategoryFormModal` (lista de categorías) y
 * `CategoryQuickCreateModal` (formulario de producto). Van dentro de un
 * `<form>` que se lee con `readCategoryForm`.
 *
 * El IVA nunca se teclea: se elige una alícuota del catálogo. La alícuota solo
 * viaja en un alta o cuando el usuario la cambia: al editar sin tocarla, la
 * categoría conserva la que tenía aunque ya no esté activa.
 */
export function CategoryFormFields({
  category,
  errorMessage,
  showDescription = true,
}: CategoryFormFieldsProps) {
  const { byPct, error, isLoading, rates, refetch } = useTaxRates({ activeOnly: false });
  const [chosen, setChosen] = useState<TaxRateSelection | null>(null);
  const selection = chosen ?? resolveInitialSelection(category, rates, byPct);
  const submittedPct = category ? chosen?.pct : selection?.pct;

  return (
    <>
      <Input defaultValue={category?.name} label="Nombre" name="name" required />
      <div className="space-y-2">
        <p className={formLabelClassName}>Alícuota de IVA</p>
        <TaxRateChips
          error={error}
          isLoading={isLoading}
          onChange={(code, rate) => setChosen({ code, pct: rate.pct })}
          onRetry={() => void refetch()}
          rates={rates}
          size="md"
          value={selection?.code ?? null}
          valuePct={selection?.pct}
        />
        <p className={formHelperClassName}>
          Impuesto que se aplica a los productos de esta categoría.
        </p>
        {submittedPct !== undefined ? (
          <input name={TAX_RATE_FIELD_NAME} type="hidden" value={submittedPct} />
        ) : null}
      </div>
      {showDescription ? (
        <Textarea
          defaultValue={category?.description ?? ""}
          label="Descripción (opcional)"
          name="description"
          rows={3}
        />
      ) : null}
      {errorMessage ? (
        <p className="min-w-0 text-sm text-destructive [overflow-wrap:anywhere]" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </>
  );
}

/** Lee el `<form>` que contiene `CategoryFormFields`. Sin alícuota en el formulario, no viaja. */
export function readCategoryForm(form: HTMLFormElement): CategoryInput {
  const formData = new FormData(form);
  const taxRate = formData.get(TAX_RATE_FIELD_NAME);

  return {
    description: String(formData.get("description") ?? "").trim() || undefined,
    name: String(formData.get("name") ?? "").trim(),
    ...(taxRate === null ? {} : { taxRate: Number(taxRate) }),
  };
}
