"use client";

import { type FormEvent, useEffect, useId, useState } from "react";

import type { CategoryMock } from "@/shared/mocks/erp-data";
import { FormActions } from "@/shared/components/FormActions";
import { GenerateSkuIconButton } from "@/shared/components/GenerateSkuIconButton";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";
import { SelectField } from "@/shared/components/SelectField";

import type { ProductImportRowDraft } from "../../services/validateProductImportRows";
import { validatedRowToDraft } from "../../services/validateProductImportRows";
import type { ProductImportValidatedRow } from "../../types";
import { generateProductSkuFromName } from "@/shared/utils/skuGeneration";

type ProductImportRowEditModalProps = {
  categories: CategoryMock[];
  onOpenChange: (open: boolean) => void;
  onSave: (draft: ProductImportRowDraft) => void;
  open: boolean;
  row: ProductImportValidatedRow | null;
};

export function ProductImportRowEditModal({
  categories,
  onOpenChange,
  onSave,
  open,
  row,
}: ProductImportRowEditModalProps) {
  const formId = useId();
  const [draft, setDraft] = useState<ProductImportRowDraft | null>(null);

  useEffect(() => {
    if (row && open) {
      setDraft(validatedRowToDraft(row));
    }
  }, [open, row]);

  if (!row || !draft) {
    return null;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) {
      return;
    }
    onSave(draft);
    onOpenChange(false);
  }

  function updateField<K extends keyof ProductImportRowDraft>(
    key: K,
    value: ProductImportRowDraft[K],
  ) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  return (
    <Modal
      description={`Corrige los datos de la fila ${row.rowIndex} antes de importar. Los cambios solo aplican en esta sesión, no modifican el archivo Excel.`}
      footer={({ close }) => (
        <FormActions
          onCancel={close}
          submitFormId={formId}
          submitLabel="Guardar fila"
        />
      )}
      onOpenChange={onOpenChange}
      open={open}
      title="Editar fila de importación"
    >
      <form className="grid gap-4" id={formId} onSubmit={handleSubmit}>
        <Input
          label="SKU"
          name="sku"
          onChange={(event) => updateField("sku", event.target.value.toLowerCase())}
          required
          trailing={
            <GenerateSkuIconButton
              disabled={!draft.nombre.trim()}
              onGenerate={() => updateField("sku", generateProductSkuFromName(draft.nombre))}
            />
          }
          value={draft.sku}
        />
        <Input
          label="Codigo de barras"
          name="codigo_barras"
          onChange={(event) => updateField("codigo_barras", event.target.value)}
          placeholder="Opcional"
          value={draft.codigo_barras}
        />
        <Input
          label="Nombre"
          name="nombre"
          onChange={(event) => updateField("nombre", event.target.value)}
          required
          value={draft.nombre}
        />
        <SelectField
          label="Categoría"
          name="categoryId"
          onChange={(event) => updateField("categoryId", event.target.value)}
          options={[
            { label: "Sin categoría", value: "" },
            ...categories.map((category) => ({
              label: category.name,
              value: category.id,
            })),
          ]}
          value={draft.categoryId}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Precio ref (USD)"
            min={0}
            name="precio_ref"
            onChange={(event) => updateField("precio_ref", event.target.value)}
            required
            step="0.01"
            type="number"
            value={draft.precio_ref}
          />
          <Input
            label="Costo ref (USD)"
            min={0}
            name="costo_ref"
            onChange={(event) => updateField("costo_ref", event.target.value)}
            step="0.01"
            type="number"
            value={draft.costo_ref}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Stock inicial"
            min={0}
            name="stock_inicial"
            onChange={(event) => updateField("stock_inicial", event.target.value)}
            step="1"
            type="number"
            value={draft.stock_inicial}
          />
          <Input
            label="Stock mínimo"
            min={0}
            name="stock_minimo"
            onChange={(event) => updateField("stock_minimo", event.target.value)}
            step="1"
            type="number"
            value={draft.stock_minimo}
          />
        </div>
        <p className="text-xs text-on-surface-variant">
          Deja costo o stock vacíos para usar los valores por defecto del sistema (0 / 5).
        </p>
      </form>
    </Modal>
  );
}
