"use client";

import { type FormEvent, type ReactNode, useId, useMemo, useState } from "react";

import { useContacts } from "@/modules/contacts/hooks/useContacts";
import { useCreateSupplierProduct } from "@/modules/contacts/hooks/useSupplierProductMutations";
import { useProducts } from "@/modules/products/hooks/useProducts";
import { getPaginatedItems } from "@/lib/api/pagination";
import { GenerateSkuIconButton } from "@/shared/components/GenerateSkuIconButton";
import { FormActions } from "@/shared/components/FormActions";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";
import { SearchAutocomplete } from "@/shared/components/SearchAutocomplete";
import { SelectField } from "@/shared/components/SelectField";
import { Textarea } from "@/shared/components/Textarea";
import { generateSupplierSkuFromProduct } from "@/shared/utils/skuGeneration";

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
  const [supplierId, setSupplierId] = useState(fixedSupplierId);
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
  const contacts = useContacts();
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

  const supplierOptions = useMemo(
    () =>
      getPaginatedItems(contacts.data)
        .filter((contact) => contact.type === "proveedor" || contact.type === "ambos")
        .map((contact) => ({
          label: contact.name,
          value: contact.id,
        })),
    [contacts.data],
  );

  const resolvedProductSku = fixedProductSku ?? selectedProductSku;

  const resolvedSupplierName = useMemo(() => {
    if (linkFromProduct) {
      return supplierOptions.find((option) => option.value === supplierId)?.label ?? "";
    }

    return supplierName ?? "";
  }, [linkFromProduct, supplierId, supplierName, supplierOptions]);

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
      setSupplierId(fixedSupplierId);
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
    const resolvedSupplierId = fixedSupplierId || supplierId;

    if (!resolvedProductId) {
      setErrorMessage("Selecciona un producto.");
      return;
    }

    if (!resolvedSupplierId) {
      setErrorMessage("Selecciona un proveedor.");
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
            <SelectField
              label="Proveedor"
              onChange={(event) => setSupplierId(event.target.value)}
              options={supplierOptions}
              placeholder="Selecciona un proveedor"
              required
              value={supplierId}
            />
          </>
        ) : (
          <SearchAutocomplete
            error={!productId && errorMessage === "Selecciona un producto." ? errorMessage : undefined}
            helperText="Escribe al menos 2 caracteres para buscar por nombre, SKU o codigo de barras."
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
            placeholder="Buscar por nombre, SKU o codigo de barras..."
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
        {errorMessage && errorMessage !== "Selecciona un producto." ? (
          <p className="text-sm text-error">{errorMessage}</p>
        ) : null}
      </form>
    </Modal>
  );
}
