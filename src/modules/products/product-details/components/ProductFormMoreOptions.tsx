"use client";

import { CollapsibleSection } from "@/shared/components/CollapsibleSection";
import { GenerateSkuIconButton } from "@/shared/components/GenerateSkuIconButton";
import { Input } from "@/shared/components/Input";
import { NumberInput } from "@/shared/components/NumberInput";
import { Textarea } from "@/shared/components/Textarea";
import { generateProductSkuFromName } from "@/shared/utils/skuGeneration";

import type { ProductWithCategory } from "../../hooks/useProducts";
import {
  ProductPackConversionFields,
  type PackConversionFormState,
} from "./ProductPackConversionFields";

const SKU_HELPER_TEXT =
  "Código interno; si tienes código de barras, úsalo. Si lo dejas vacío se genera solo.";

type ProductFormMoreOptionsProps = {
  isEdit: boolean;
  isUnitRole: boolean;
  onOpenChange: (open: boolean) => void;
  onPackConversionChange: (patch: Partial<PackConversionFormState>) => void;
  onSkuChange: (sku: string) => void;
  open: boolean;
  packConversionState: PackConversionFormState;
  product?: ProductWithCategory;
  productName: string;
  /** Tras intentar enviar: muestra el aviso de unidades por empaque. */
  showErrors: boolean;
  sku: string;
};

/**
 * Segundo nivel del formulario de producto: SKU, Descripción, stock y empaque.
 * Cerrada, la sección solo se oculta (`hidden`): sus campos siguen montados y
 * viajan en el envío igual que si estuviera abierta.
 */
export function ProductFormMoreOptions({
  isEdit,
  isUnitRole,
  onOpenChange,
  onPackConversionChange,
  onSkuChange,
  open,
  packConversionState,
  product,
  productName,
  showErrors,
  sku,
}: ProductFormMoreOptionsProps) {
  return (
    <CollapsibleSection
      onOpenChange={onOpenChange}
      open={open}
      summary={
        isEdit && product
          ? `SKU ${sku || product.sku} · Stock actual ${product.currentStock}`
          : "SKU, descripción, stock y empaque"
      }
      title="Más opciones"
    >
      <div className="grid gap-4">
        <Input
          helperText={SKU_HELPER_TEXT}
          label="SKU"
          name="sku"
          onChange={(event) => onSkuChange(event.target.value.toLowerCase())}
          trailing={
            <GenerateSkuIconButton
              disabled={!productName.trim()}
              onGenerate={() => onSkuChange(generateProductSkuFromName(productName))}
            />
          }
          value={sku}
        />
        <Textarea label="Descripción" placeholder="Detalles del producto" />
        <div className="grid gap-4 md:grid-cols-2">
          {isEdit ? (
            <NumberInput
              decimals={0}
              defaultValue={product?.currentStock}
              disabled
              helperText="Se corrige desde Inventario con un ajuste, para que quede registrado el movimiento."
              label="Stock actual"
              readOnly
            />
          ) : (
            <NumberInput
              decimals={0}
              defaultValue={product?.currentStock}
              label="Stock inicial"
              name="currentStock"
            />
          )}
          <NumberInput
            decimals={0}
            defaultValue={product?.minStock}
            label="Stock mínimo"
            name="minStock"
          />
        </div>
        <ProductPackConversionFields
          excludeProductId={product?.id}
          isUnitRole={isUnitRole}
          packConversion={product?.packConversion}
          productName={productName}
          showErrors={showErrors}
          state={packConversionState}
          onChange={onPackConversionChange}
        />
      </div>
    </CollapsibleSection>
  );
}
