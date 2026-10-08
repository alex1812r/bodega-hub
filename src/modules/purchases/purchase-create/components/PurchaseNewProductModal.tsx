"use client";

import { getPaginatedItems } from "@/lib/api/pagination";
import {
  type ProductWithCategory,
  useAllCategories,
  useCreateProduct,
} from "@/modules/products/hooks/useProducts";
import {
  type ProductFormInitialValues,
  ProductFormModal,
} from "@/modules/products/product-details/components/ProductFormModal";

type PurchaseNewProductModalProps = {
  /** Lo buscado en la compra: nombre, o código de barras si eran solo dígitos. */
  initialValues?: ProductFormInitialValues;
  /** Producto ya creado, con su categoría (de ella sale la alícuota de la línea). */
  onCreated: (product: ProductWithCategory) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

/**
 * Alta rápida de producto sin salir de la compra (COM-03): el formulario de
 * Productos en modo `compact`. Un error del servidor (SKU o código de barras
 * duplicado) se queda dentro del modal y no se llama a `onCreated`.
 *
 * El vínculo con el proveedor no se crea aquí: lo crea `create_purchase` al
 * confirmar la compra.
 */
export function PurchaseNewProductModal({
  initialValues,
  onCreated,
  onOpenChange,
  open,
}: PurchaseNewProductModalProps) {
  const createProduct = useCreateProduct();
  const categories = getPaginatedItems(useAllCategories({}, { enabled: open }).data);

  function handleOpenChange(nextOpen: boolean) {
    // El error de un alta fallida no debe seguir visible al reabrir.
    createProduct.reset();
    onOpenChange(nextOpen);
  }

  function handleCreated(product: ProductWithCategory) {
    // El alta devuelve el producto sin su categoría anidada.
    onCreated({
      ...product,
      category:
        product.category ?? categories.find((category) => category.id === product.categoryId),
    });
  }

  return (
    <ProductFormModal
      categories={categories}
      compact
      errorMessage={createProduct.error?.message}
      initialValues={initialValues}
      isSubmitting={createProduct.isPending}
      onCreated={handleCreated}
      onOpenChange={handleOpenChange}
      // Tal cual: lleva la clave de idempotencia y debe rechazar con el error original.
      onSubmit={(input) => createProduct.mutateAsync(input)}
      open={open}
    />
  );
}
