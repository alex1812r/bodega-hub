"use client";

import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";

import { getFormSaveDescription } from "@/lib/api/dataSourceUi";
import { InventoryAdjustmentModal } from "@/modules/inventory/inventory-movements/components/InventoryAdjustmentModal";
import { Can } from "@/shared/auth/Can";
import { Button } from "@/shared/components/Button";
import { FormActions } from "@/shared/components/FormActions";
import { Modal } from "@/shared/components/Modal";
import { getNumberInputError } from "@/shared/components/NumberInput";
import type { CategoryMock } from "@/shared/mocks/erp-data";

import { CategoryQuickCreateModal } from "../../categories-list/components/CategoryQuickCreateModal";
import type { ProductInput, ProductWithCategory } from "../../hooks/useProducts";
import { normalizeBarcode } from "../../services/productSearch";
import {
  removeProductImage,
  uploadProductImageBlob,
} from "../../services/uploadProductImage";
import { ProductFormBasicFields } from "./ProductFormBasicFields";
import { ProductFormMoreOptions } from "./ProductFormMoreOptions";
import { ProductImageUploadField } from "./ProductImageUploadField";
import {
  createDefaultPackConversionFormState,
  findUnitProductField,
  getUnitProductError,
  getUnitsPerPackError,
  packConversionStateToInput,
  UNITS_PER_PACK_FIELD_NAME,
  type PackConversionFormState,
} from "./ProductPackConversionFields";

export type ProductFormSubmitContext = {
  pendingImageBlob?: Blob | null;
};

/**
 * Valores con los que abre un alta (p. ej. el texto buscado o el código
 * escaneado en una compra). En edición se ignoran: manda `product`.
 */
export type ProductFormInitialValues = Partial<
  Pick<ProductInput, "barcode" | "categoryId" | "currentCostRef" | "name" | "salePriceRef">
>;

/**
 * Contrato del formulario de producto. Estable: lo consumen Productos (lista y
 * detalle) y, en modo `compact`, Compras (COM-03) y el surtido (PRO-13).
 */
export type ProductFormModalProps = {
  /**
   * Opciones del selector de Categoría. Con `products.manage` el formulario
   * ofrece además "+ Nueva categoría": la categoría creada ahí queda elegida y
   * se lista aunque esta prop todavía no la traiga.
   */
  categories?: CategoryMock[];
  /**
   * Alta rápida: solo el nivel básico (Nombre, Categoría, Código de barras,
   * Precio REF, Costo REF), sin imagen y sin "Más opciones". Siempre es un alta:
   * `mode` y `product` se ignoran. Lo que no se muestra viaja como en un alta
   * con esos campos vacíos (sin stock inicial, sin stock mínimo, sin empaque) y
   * sin SKU: lo genera el servidor desde el nombre, único en la tienda.
   */
  compact?: boolean;
  /** Error del servidor (p. ej. `mutation.error?.message`); se muestra al pie del formulario. */
  errorMessage?: string;
  /** Precarga del alta; se lee cada vez que el modal se abre. */
  initialValues?: ProductFormInitialValues;
  isSubmitting?: boolean;
  /** `"edit"` exige `product`. Por defecto `"create"`. */
  mode?: "create" | "edit";
  /**
   * Alta terminada: recibe el producto que devolvió `onSubmit`, justo antes de
   * cerrar. No se llama en edición ni si `onSubmit` no devuelve el producto.
   */
  onCreated?: (product: ProductWithCategory) => void;
  /** Edición: la imagen se subió o se quitó; el consumidor refresca el producto. */
  onImageUpdated?: () => void | Promise<void>;
  onOpenChange?: (open: boolean) => void;
  /**
   * Guarda. Si lanza o rechaza, el modal queda abierto (el consumidor muestra el
   * motivo con `errorMessage`). Puede devolver el producto creado para que
   * llegue a `onCreated`; no devolver nada sigue siendo válido.
   */
  onSubmit?: (
    input: ProductInput,
    context?: ProductFormSubmitContext,
  ) => Promise<ProductWithCategory | void> | ProductWithCategory | void;
  /** Modo controlado. Sin `open`, el modal se abre con `trigger` (o su botón por defecto). */
  open?: boolean;
  /** Producto en edición. */
  product?: ProductWithCategory;
  trigger?: ReactNode;
};

function numberFromFormData(formData: FormData, key: string) {
  const value = formData.get(key);

  return value === null || value === "" ? undefined : Number(value);
}

export function ProductFormModal({
  categories = [],
  compact = false,
  errorMessage,
  initialValues,
  isSubmitting = false,
  mode = "create",
  onCreated,
  onImageUpdated,
  onOpenChange,
  onSubmit,
  open,
  product: productProp,
  trigger,
}: ProductFormModalProps) {
  const isEdit = !compact && mode === "edit";
  const product = compact ? undefined : productProp;
  const createDefaults = isEdit ? undefined : initialValues;
  const formId = useId();
  const isControlled = open !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = isControlled ? open : internalOpen;
  const [name, setName] = useState(product?.name ?? createDefaults?.name ?? "");
  const [sku, setSku] = useState(product?.sku ?? "");
  const [categoryId, setCategoryId] = useState(
    product?.categoryId ?? createDefaults?.categoryId ?? "",
  );
  // Categorías creadas desde aquí: se ofrecen sin esperar a que el consumidor
  // vuelva a pasar `categories` con la lista refrescada.
  const [createdCategories, setCreatedCategories] = useState<CategoryMock[]>([]);
  const [categoryCreateOpen, setCategoryCreateOpen] = useState(false);
  const categoryCreateTriggerRef = useRef<HTMLButtonElement | null>(null);
  const categoryOptions = useMemo(
    () => [
      ...categories,
      ...createdCategories.filter(
        (created) => !categories.some((category) => category.id === created.id),
      ),
    ],
    [categories, createdCategories],
  );
  const [moreOptionsOpen, setMoreOptionsOpen] = useState(false);
  const [pendingImageBlob, setPendingImageBlob] = useState<Blob | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [packConversionState, setPackConversionState] = useState<PackConversionFormState>(
    createDefaultPackConversionFormState(product?.packConversion),
  );
  const [showSubmitErrors, setShowSubmitErrors] = useState(false);
  const [stockAdjustmentOpen, setStockAdjustmentOpen] = useState(false);
  const stockAdjustmentTriggerRef = useRef<HTMLButtonElement | null>(null);
  // Candado propio: `isSubmitting` llega con el siguiente render, tarde para un
  // segundo Enter o un clic en el mismo tick.
  const isSubmitInFlightRef = useRef(false);
  const [failedSubmits, setFailedSubmits] = useState(0);
  const isUnitRole = product?.packConversion?.role === "unit";

  useEffect(() => {
    if (isOpen) {
      resetFormFields();
    }
    // Reset when opening or when the loaded product payload changes (e.g. detail fetch).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional on open/product.id
  }, [isOpen, product?.id, product?.packConversion?.id]);

  function resetFormFields() {
    setName(product?.name ?? createDefaults?.name ?? "");
    setSku(product?.sku ?? "");
    setCategoryId(product?.categoryId ?? createDefaults?.categoryId ?? "");
    setMoreOptionsOpen(false);
    setPendingImageBlob(null);
    setImageError(null);
    setPackConversionState(createDefaultPackConversionFormState(product?.packConversion));
    setShowSubmitErrors(false);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!isControlled) {
      setInternalOpen(nextOpen);
    }
    onOpenChange?.(nextOpen);
    if (nextOpen) {
      resetFormFields();
    }
  }

  function openStockAdjustment(trigger: HTMLButtonElement) {
    stockAdjustmentTriggerRef.current = trigger;
    setStockAdjustmentOpen(true);
  }

  // El ajuste se cierra (cancelado o registrado) y este formulario sigue abierto
  // con lo escrito. El Modal compartido no devuelve el foco: se desmonta en el
  // mismo tick y vuelve al botón que lo abrió.
  function handleStockAdjustmentOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      return;
    }

    flushSync(() => setStockAdjustmentOpen(false));
    stockAdjustmentTriggerRef.current?.focus();
  }

  function openCategoryCreate(trigger: HTMLButtonElement) {
    categoryCreateTriggerRef.current = trigger;
    setCategoryCreateOpen(true);
  }

  // Igual que el ajuste de stock: al cerrar, este formulario sigue abierto con
  // lo escrito y el foco vuelve al botón que abrió el alta de categoría.
  function handleCategoryCreateOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      return;
    }

    flushSync(() => setCategoryCreateOpen(false));
    categoryCreateTriggerRef.current?.focus();
  }

  function handleCategoryCreated(category: CategoryMock) {
    setCreatedCategories((current) => [...current, category]);
    setCategoryId(category.id);
  }

  // Un campo de "Más opciones" con la sección cerrada no puede recibir el foco:
  // se abre en el mismo tick, se muestran los avisos y se enfoca.
  function revealAndFocus(field: Element | RadioNodeList | null) {
    flushSync(() => {
      setMoreOptionsOpen(true);
      setShowSubmitErrors(true);
    });

    if (field instanceof HTMLElement) {
      field.focus();
    }
  }

  // Red para los `required` nativos de la sección cerrada (los del empaque): el
  // navegador no puede señalar un campo oculto y bloquearía el envío en silencio.
  function handleInvalidCapture(event: FormEvent<HTMLFormElement>) {
    const field = event.target;
    const firstInvalid = Array.from(event.currentTarget.elements).find(
      (element) =>
        (element instanceof HTMLInputElement ||
          element instanceof HTMLSelectElement ||
          element instanceof HTMLTextAreaElement) &&
        element.willValidate &&
        !element.validity.valid,
    );

    if (field instanceof HTMLElement && field === firstInvalid && field.closest("[hidden]")) {
      revealAndFocus(field);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>, close: () => void) {
    event.preventDefault();

    if (isSubmitting || isSubmitInFlightRef.current) {
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    const shouldSendPackConversion =
      !isUnitRole &&
      (Boolean(product?.packConversion) || packConversionState.enabled);
    // Sin `required`/`step`/`min` nativos: un stock con decimales o un empaque
    // de menos de 2 unidades no se envía, ni un empaque vinculado sin producto
    // unidad. El campo muestra su aviso y recibe el foco. Se revisan en el orden
    // en que aparecen en "Más opciones".
    const invalidFieldName =
      ["currentStock", "minStock"].find((fieldName) =>
        getNumberInputError(String(formData.get(fieldName) ?? ""), { decimals: 0 }),
      ) ??
      (shouldSendPackConversion &&
      packConversionState.enabled &&
      getUnitsPerPackError(packConversionState.unitsPerPack)
        ? UNITS_PER_PACK_FIELD_NAME
        : undefined);

    if (invalidFieldName) {
      revealAndFocus(form.elements.namedItem(invalidFieldName));

      return;
    }

    if (shouldSendPackConversion && getUnitProductError(packConversionState)) {
      revealAndFocus(findUnitProductField(form));

      return;
    }

    const input: ProductInput = {
      barcode: normalizeBarcode(String(formData.get("barcode") ?? "")),
      // Del <select>, no del estado: una categoría que ya no está entre las
      // opciones (desactivada) no viaja y el producto conserva la suya.
      categoryId: String(formData.get("categoryId") ?? "") || undefined,
      currentCostRef: numberFromFormData(formData, "currentCostRef"),
      // Solo al crear. En edicion el stock no viaja: el formulario mandaba el
      // valor cargado al abrir y pisaba las ventas hechas mientras tanto, sin
      // dejar movimiento. Las existencias se corrigen con un ajuste de inventario.
      ...(isEdit ? {} : { currentStock: numberFromFormData(formData, "currentStock") }),
      minStock: numberFromFormData(formData, "minStock"),
      name: name.trim(),
      packConversion: shouldSendPackConversion
        ? packConversionStateToInput(packConversionState)
        : undefined,
      salePriceRef: Number(formData.get("salePriceRef") ?? 0),
      // Vacío no viaja: en el alta el servidor lo genera desde el nombre y en
      // la edición se conserva el que tiene el producto.
      sku: sku.trim().toLowerCase() || undefined,
    };

    // Si `onSubmit` rechaza, no se llega a `close()`: el modal queda abierto y
    // el rechazo sigue subiendo.
    let created: ProductWithCategory | void;

    isSubmitInFlightRef.current = true;

    try {
      created = await onSubmit?.(input, { pendingImageBlob });
    } catch (error) {
      setFailedSubmits((count) => count + 1);
      throw error;
    } finally {
      isSubmitInFlightRef.current = false;
    }

    if (!isEdit && created) {
      onCreated?.(created);
    }

    close();
  }

  async function handleUploadImage(blob: Blob) {
    if (!product?.id) {
      return;
    }

    setIsUploadingImage(true);
    setImageError(null);

    try {
      await uploadProductImageBlob(product.id, blob);
      await onImageUpdated?.();
    } catch (error) {
      setImageError(
        error instanceof Error ? error.message : "No se pudo subir la imagen del producto.",
      );
      throw error;
    } finally {
      setIsUploadingImage(false);
    }
  }

  async function handleRemoveImage() {
    if (!product?.id) {
      return;
    }

    setIsUploadingImage(true);
    setImageError(null);

    try {
      await removeProductImage(product.id);
      await onImageUpdated?.();
    } catch (error) {
      setImageError(
        error instanceof Error ? error.message : "No se pudo quitar la imagen del producto.",
      );
    } finally {
      setIsUploadingImage(false);
    }
  }

  return (
    <Modal
      description={getFormSaveDescription()}
      footer={({ close }) => (
        <FormActions
          isSubmitting={isSubmitting || isUploadingImage}
          onCancel={close}
          submitFormId={formId}
          submitLabel={isEdit ? "Guardar cambios" : "Crear producto"}
        />
      )}
      onOpenChange={handleOpenChange}
      open={isOpen}
      title={isEdit ? "Editar producto" : compact ? "Nuevo producto" : "Crear producto"}
      trigger={
        isControlled
          ? trigger
          : (trigger ?? (
              <Button size="sm" variant={isEdit ? "outline" : "primary"}>
                {isEdit ? "Editar producto" : "Nuevo producto"}
              </Button>
            ))
      }
    >
      <form
        className="grid gap-4"
        id={formId}
        onInvalidCapture={handleInvalidCapture}
        onSubmit={(event) => handleSubmit(event, () => handleOpenChange(false))}
      >
        <ProductFormBasicFields
          categories={categoryOptions}
          categoryId={categoryId}
          defaults={product ?? createDefaults ?? {}}
          image={
            compact ? undefined : (
              <Can permission="products.manage">
                <ProductImageUploadField
                  disabled={isSubmitting}
                  imageUrl={product?.imageUrl}
                  isUploading={isUploadingImage}
                  onPendingBlobChange={isEdit ? undefined : setPendingImageBlob}
                  onRemove={isEdit && product?.imageUrl ? handleRemoveImage : undefined}
                  onUpload={isEdit && product?.id ? handleUploadImage : undefined}
                />
              </Can>
            )
          }
          name={name}
          onCategoryChange={setCategoryId}
          onCreateCategory={openCategoryCreate}
          onNameChange={setName}
        />
        {compact ? (
          <p className="text-sm text-on-surface-variant">
            Se crea con lo básico y el SKU se genera solo. El stock, el empaque y la imagen se
            completan después desde Productos.
          </p>
        ) : (
          <ProductFormMoreOptions
            isEdit={isEdit}
            isUnitRole={isUnitRole}
            onAdjustStock={isEdit && product ? openStockAdjustment : undefined}
            onOpenChange={setMoreOptionsOpen}
            onPackConversionChange={(patch) =>
              setPackConversionState((current) => ({ ...current, ...patch }))
            }
            onSkuChange={setSku}
            open={moreOptionsOpen}
            packConversionState={packConversionState}
            product={product}
            productName={name}
            showErrors={showSubmitErrors}
            sku={sku}
            unitSearchResetKey={failedSubmits}
          />
        )}
        {imageError ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {imageError}
          </p>
        ) : null}
        {errorMessage ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {errorMessage}
          </p>
        ) : null}
      </form>
      {/* Fuera del <form>: el envío del ajuste no debe burbujear al del producto. */}
      {isEdit && product && stockAdjustmentOpen ? (
        <InventoryAdjustmentModal
          lockedProduct={product}
          onOpenChange={handleStockAdjustmentOpenChange}
          open
        />
      ) : null}
      {/* Fuera del <form>: crear la categoría no debe enviar el producto. */}
      {categoryCreateOpen ? (
        <CategoryQuickCreateModal
          onCreated={handleCategoryCreated}
          onOpenChange={handleCategoryCreateOpenChange}
        />
      ) : null}
    </Modal>
  );
}
