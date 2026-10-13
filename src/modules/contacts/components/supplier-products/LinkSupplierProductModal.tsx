"use client";

import { type FormEvent, type ReactNode, useId, useMemo, useState } from "react";

import { useCreateSupplierProduct } from "@/modules/contacts/hooks/useSupplierProductMutations";
import { useProducts } from "@/modules/products/hooks/useProducts";
import { getPaginatedItems } from "@/lib/api/pagination";
import {
  type ContactEntityFilters,
  type ContactEntityOption,
  EntityAutocomplete,
} from "@/shared/components/EntityAutocomplete";
import { GenerateSkuIconButton } from "@/shared/components/GenerateSkuIconButton";
import { FormActions } from "@/shared/components/FormActions";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";
import { SearchAutocomplete } from "@/shared/components/SearchAutocomplete";
import { Textarea } from "@/shared/components/Textarea";
import { generateSupplierSkuFromProduct } from "@/shared/utils/skuGeneration";

const SUPPLIER_FILTERS: ContactEntityFilters = { active: true, type: ["proveedor", "ambos"] };
const MISSING_PRODUCT_MESSAGE = "Selecciona un producto.";
const MISSING_SUPPLIER_MESSAGE = "Selecciona un proveedor.";

type LinkSupplierProductModalProps = {
  onOpenChange?: (open: boolean) => void;
  onSuccess?: () => void;
  open?: boolean;
  productId?: string;
  productName?: string;
  productSku?: string;
  supplierId: string;
  supplierName?: string;
  trigger?: ReactNode;
};

export function LinkSupplierProductModal({
  onOpenChange,
  onSuccess,
  open,
  productId: fixedProductId,
  productName,
  productSku: fixedProductSku,
  supplierId: fixedSupplierId,
  supplierName,
  trigger,
}: LinkSupplierProductModalProps) {
  const formId = useId();
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const currentOpen = isControlled ? open : internalOpen;
  const [productId, setProductId] = useState(fixedProductId ?? "");
  const [productSearch, setProductSearch] = useState("");
  const [selectedProductLabel, setSelectedProductLabel] = useState("");
  const [selectedProductSku, setSelectedProductSku] = useState(fixedProductSku ?? "");
  const [supplier, setSupplier] = useState<ContactEntityOption | null>(null);
  const [supplierSku, setSupplierSku] = useState("");
  const [lastCostRef, setLastCostRef] = useState("");
  const [notes, setNotes] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const trimmedProductSearch = productSearch.trim();
  const products = useProducts({
    isActive: true,
    limit: 20,
    search: trimmedProductSearch.length >= 2 ? trimmedProductSearch : undefined,
  });
  const createSupplierProduct = useCreateSupplierProduct();
  const linkFromProduct = Boolean(fixedProductId);

  const productOptions = useMemo(
    () =>
      getPaginatedItems(products.data).map((product) => ({
        id: product.id,
        label: product.name,
        sublabel: product.sku,
      })),
    [products.data],
  );

  const resolvedProductSku = fixedProductSku ?? selectedProductSku;

  const resolvedSupplierName = linkFromProduct ? (supplier?.label ?? "") : (supplierName ?? "");
  const productFieldError =
    !linkFromProduct && !productId && errorMessage === MISSING_PRODUCT_MESSAGE
      ? errorMessage
      : undefined;
  const supplierFieldError =
    linkFromProduct && !supplier && errorMessage === MISSING_SUPPLIER_MESSAGE
      ? errorMessage
      : undefined;

  const canGenerateSupplierSku =
    resolvedProductSku.trim().length > 0 && resolvedSupplierName.trim().length > 0;

  function handleOpenChange(nextOpen: boolean) {
    if (!isControlled) {
      setInternalOpen(nextOpen);
    }
    onOpenChange?.(nextOpen);

    if (!nextOpen) {
      setProductId(fixedProductId ?? "");
      setProductSearch("");
      setSelectedProductLabel("");
      setSelectedProductSku(fixedProductSku ?? "");
      setSupplier(null);
      setSupplierSku("");
      setLastCostRef("");
      setNotes("");
      setErrorMessage(null);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    const resolvedProductId = fixedProductId ?? productId;
    const resolvedSupplierId = fixedSupplierId || (supplier?.id ?? "");

    if (!resolvedProductId) {
      setErrorMessage(MISSING_PRODUCT_MESSAGE);
      return;
    }

    if (!resolvedSupplierId) {
      setErrorMessage(MISSING_SUPPLIER_MESSAGE);
      return;
    }

    const parsedCost = lastCostRef.trim() ? Number(lastCostRef) : undefined;

    if (parsedCost != null && (Number.isNaN(parsedCost) || parsedCost < 0)) {
      setErrorMessage("El costo inicial debe ser mayor o igual a 0.");
      return;
    }

    try {
      await createSupplierProduct.mutateAsync({
        lastCostRef: parsedCost,
        notes: notes.trim() || undefined,
        productId: resolvedProductId,
        supplierId: resolvedSupplierId,
        supplierSku: supplierSku.trim() || undefined,
      });
      handleOpenChange(false);
      onSuccess?.();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No se pudo vincular el producto.");
    }
  }

  return (
    <Modal
      description={
        linkFromProduct
          ? `Asocia un proveedor al producto ${productName ?? "seleccionado"}. No requiere registrar una compra.`
          : supplierName
            ? `Asocia un producto del catálogo a ${supplierName}. No requiere registrar una compra.`
            : "Asocia un producto del catálogo a este proveedor. No requiere registrar una compra."
      }
      footer={({ close }) => (
        <FormActions
          isSubmitting={createSupplierProduct.isPending}
          onCancel={close}
          submitFormId={formId}
          submitLabel={linkFromProduct ? "Vincular proveedor" : "Vincular producto"}
          submittingLabel="Vinculando..."
        />
      )}
      onOpenChange={handleOpenChange}
      open={currentOpen}
      title={linkFromProduct ? "Vincular proveedor" : "Vincular producto"}
      trigger={trigger}
    >
      <form className="space-y-4" id={formId} onSubmit={(event) => void handleSubmit(event)}>
        {linkFromProduct ? (
          <>
            <Input label="Producto" readOnly value={productName ?? fixedProductId ?? ""} />
            <EntityAutocomplete
              entity="contact"
              error={supplierFieldError}
              filters={SUPPLIER_FILTERS}
              label="Proveedor"
              onChange={(option) => {
                setSupplier(option);
                setErrorMessage(null);
              }}
              // Un reciente guardado puede haberse desactivado: aquí no se ofrecen.
              recentsKey={null}
              required
              value={supplier}
            />
          </>
        ) : (
          <SearchAutocomplete
            error={productFieldError}
            helperText="Escribe al menos 2 caracteres para buscar por nombre, SKU o código de barras."
            isLoading={products.isFetching && trimmedProductSearch.length >= 2}
            label="Producto"
            onQueryChange={(nextQuery) => {
              setProductSearch(nextQuery);
              if (selectedProductLabel) {
                setProductId("");
                setSelectedProductLabel("");
                setSelectedProductSku("");
              }
            }}
            onSelect={(option) => {
              setProductId(option.id);
              setSelectedProductSku(option.sublabel ?? "");
              setSelectedProductLabel(
                option.sublabel ? `${option.label} (${option.sublabel})` : option.label,
              );
              setErrorMessage(null);
            }}
            options={productOptions}
            placeholder="Buscar por nombre, SKU o código de barras..."
            query={productSearch}
            required
            selectedLabel={selectedProductLabel}
          />
        )}
        <Input
          label="SKU del proveedor"
          onChange={(event) => setSupplierSku(event.target.value.toLowerCase())}
          placeholder="Código del mayorista"
          trailing={
            <GenerateSkuIconButton
              disabled={!canGenerateSupplierSku}
              onGenerate={() =>
                setSupplierSku(
                  generateSupplierSkuFromProduct(resolvedProductSku, resolvedSupplierName),
                )
              }
            />
          }
          value={supplierSku}
        />
        <Input
          inputMode="decimal"
          label="Costo inicial REF"
          onChange={(event) => setLastCostRef(event.target.value)}
          placeholder="0.00"
          value={lastCostRef}
        />
        <p className="text-xs text-on-surface-variant">
          Si indicas un costo, se registrará como cotización inicial en el historial.
        </p>
        <Textarea
          label="Notas"
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Observaciones opcionales"
          rows={2}
          value={notes}
        />
        {errorMessage && !productFieldError && !supplierFieldError ? (
          <p className="text-sm text-error">{errorMessage}</p>
        ) : null}
      </form>
    </Modal>
  );
}
