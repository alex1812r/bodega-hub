"use client";

import {
  type FormEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useEffectEvent,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";

import { getFormSaveDescription } from "@/lib/api/dataSourceUi";
import { getPaginatedItems } from "@/lib/api/pagination";
import { InventoryAdjustmentModal } from "@/modules/inventory/inventory-movements/components/InventoryAdjustmentModal";
import { useRequestAttempt } from "@/modules/inventory/utils/requestAttempt";
import { usePricingSettings } from "@/modules/settings/hooks/useSettings";
import { Can } from "@/shared/auth/Can";
import { Button } from "@/shared/components/Button";
import { CollapsibleSection } from "@/shared/components/CollapsibleSection";
import { FormActions } from "@/shared/components/FormActions";
import { Modal } from "@/shared/components/Modal";
import { getNumberInputError } from "@/shared/components/NumberInput";
import { useToast } from "@/shared/components/Toast";
import { ClientApiError } from "@/shared/api/apiFetch";
import type { CategoryMock } from "@/shared/mocks/erp-data";

import { CategoryQuickCreateModal } from "../../categories-list/components/CategoryQuickCreateModal";
import {
  type ProductInput,
  type ProductSupplierSaveInput,
  type ProductWithCategory,
  type SaveProductSuppliersResult,
  useCreateProduct,
  useProductSuppliers,
  useSaveSuppliersForProduct,
} from "../../hooks/useProducts";
import { getProductPricingOptions } from "../../services/productMargin";
import { normalizeBarcode } from "../../services/productSearch";
import { cleanText } from "../../services/productText";
import {
  removeProductImage,
  uploadProductImageBlob,
} from "../../services/uploadProductImage";
import {
  addProductToPackComponents,
  findAssortedInvalidField,
  findPackComponentUnitsField,
  getAssortedPackErrors,
} from "./PackAssortedComponentsFields";
import {
  PRODUCT_PRICING_BLOCK_ATTRIBUTE,
  ProductFormBasicFields,
} from "./ProductFormBasicFields";
import { ProductFormMoreOptions } from "./ProductFormMoreOptions";
import { ProductImageUploadField } from "./ProductImageUploadField";
import {
  buildProductSuppliersPayload,
  createProductSuppliersState,
  EMPTY_PRODUCT_SUPPLIERS_STATE,
  findProductSuppliersInvalidField,
  getProductSuppliersErrors,
  PRODUCT_SUPPLIERS_LOAD_FILTERS,
  type ProductSupplierLinkSource,
  ProductSuppliersFields,
  type ProductSuppliersFormState,
} from "./ProductSuppliersFields";
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
 *
 * El alta completa (ni edición ni `compact`) ofrece además "Guardar y crear
 * otro": tras guardar, el modal sigue abierto con el formulario en sus valores
 * iniciales (sin imagen pendiente, "Más opciones" cerrada, sin avisos), el foco
 * en Nombre y la Categoría recién usada ya elegida, para dar altas en serie de
 * una misma categoría. `onCreated` se llama igual que al guardar y cerrar; si
 * `onSubmit` rechaza no se limpia nada.
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
   * Costo REF y el bloque de precio), sin imagen y sin "Más opciones". Siempre es un alta:
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
   * cerrar (o de limpiar el formulario con "Guardar y crear otro"). No se llama en edición ni si `onSubmit` no devuelve el producto.
   */
  onCreated?: (product: ProductWithCategory) => void;
  /** Edición: la imagen se subió o se quitó; el consumidor refresca el producto. */
  onImageUpdated?: () => void | Promise<void>;
  onOpenChange?: (open: boolean) => void;
  /**
   * Guarda. Si lanza o rechaza, el modal queda abierto (el consumidor muestra el
   * motivo con `errorMessage`); el rechazo se captura aquí. Puede devolver el producto creado para que
   * llegue a `onCreated`; no devolver nada sigue siendo válido.
   */
  onSubmit?: (
    input: ProductInput,
    context?: ProductFormSubmitContext,
  ) => Promise<ProductWithCategory | void> | ProductWithCategory | void;
  /** Modo controlado. Sin `open`, el modal se abre con `trigger` (o su botón por defecto). */
  open?: boolean;
  /**
   * % de ganancia recomendados del bloque de precio, en el orden en que se
   * ofrecen. Precedencia: esta prop si se pasa; si no, los configurados en la
   * tienda (`usePricingSettings`, una query cacheada); mientras cargan o si
   * fallan (p. ej. 403), los por defecto (12 / 20 / 30). Los cortes del
   * semáforo siguen siempre la configuración de la tienda (o los por defecto).
   */
  pricingChips?: readonly number[];
  /** Producto en edición. */
  product?: ProductWithCategory;
  /**
   * Tras un alta correcta, aviso "Producto creado: <nombre>" con el enlace
   * "Ver" a su detalle (sin enlace si `onSubmit` no devolvió el producto). Por
   * defecto `true` en el alta completa y `false` en `compact`, donde el
   * consumidor decide qué avisar. En edición nunca se muestra.
   */
  showCreatedToast?: boolean;
  /**
   * % de ganancia sugerido: primer chip, destacado como "Sugerido". Solo se
   * ofrece: no fija ningún precio por sí solo. Precedencia: esta prop si se
   * pasa; si no, el `defaultMarkupPct` de la categoría elegida en el
   * formulario (cambia al cambiar de categoría); sin ninguno, no hay sugerido.
   */
  suggestedMarkupPct?: number;
  /**
   * Alta completa: muestra la sección "Proveedores" dentro de "Más opciones"
   * (en edición se muestra siempre; en `compact`, nunca). Exige que `onSubmit`
   * DEVUELVA el producto creado: sus proveedores se guardan después, con su
   * `id`, en `PUT /api/products/[id]/suppliers`. Por defecto `false`.
   */
  suppliersOnCreate?: boolean;
  trigger?: ReactNode;
};

const POSSIBLE_DUPLICATE_MESSAGE =
  "Este producto pudo haberse creado en el intento anterior. Revisa la lista antes de volver a intentarlo.";

/**
 * El envío terminó sin que el servidor dijera qué pasó (sin respuesta, 5xx o
 * 408): pudo haberse guardado. Un 4xx, 409 incluido, dice que no se guardó.
 */
function isUnansweredRequest(error: unknown) {
  return !(error instanceof ClientApiError) || error.status >= 500 || error.status === 408;
}

type ProductSuppliersLoadEvent =
  | { links: ProductSupplierLinkSource[]; status: "ready" }
  | { message: string; status: "error" };

/**
 * `idle`: edición que aún no pidió los proveedores (se piden al desplegar
 * "Proveedores", no al abrir el formulario ni "Más opciones").
 */
type ProductSuppliersLoad = { message?: string; status: "error" | "idle" | "loading" | "ready" };

type ProductSuppliersBridgeHandle = {
  reload: () => void;
  save: (
    productId: string,
    suppliers: ProductSupplierSaveInput[],
  ) => Promise<SaveProductSuppliersResult>;
};

type ProductSuppliersBridgeProps = {
  /** Producto cuyos proveedores se cargan (edición); sin él no se pide nada. */
  loadProductId?: string;
  onLoad: (event: ProductSuppliersLoadEvent) => void;
  ref: Ref<ProductSuppliersBridgeHandle>;
};

/**
 * Datos de la sección "Proveedores": carga los vínculos activos del producto
 * en edición y guarda la lista en un `PUT`. Componente aparte, montado solo
 * cuando la sección los necesita: así el modo `compact`, las altas sin
 * proveedores y una edición que no los despliega no dependen de estas consultas.
 */
function ProductSuppliersBridge({ loadProductId, onLoad, ref }: ProductSuppliersBridgeProps) {
  const { data, error, isFetching, refetch } = useProductSuppliers(
    loadProductId,
    PRODUCT_SUPPLIERS_LOAD_FILTERS,
  );
  const { mutateAsync } = useSaveSuppliersForProduct();
  const notifyLoad = useEffectEvent(onLoad);

  useImperativeHandle(
    ref,
    () => ({
      reload: () => void refetch(),
      save: (productId, suppliers) => mutateAsync({ productId, suppliers }),
    }),
    [mutateAsync, refetch],
  );

  // Solo con la respuesta ya asentada: una copia en caché que se está
  // refrescando podría no traer un vínculo creado desde Contactos.
  useEffect(() => {
    if (!loadProductId || isFetching) {
      return;
    }

    if (error) {
      notifyLoad({ message: error.message, status: "error" });
    } else if (data) {
      notifyLoad({ links: getPaginatedItems(data), status: "ready" });
    }
  }, [data, error, isFetching, loadProductId]);

  return null;
}

function getSuppliersSaveErrorReason(error: unknown) {
  const message =
    error instanceof Error && error.message ? error.message : "no se pudo completar la solicitud.";
  const issues = error instanceof Error && "issues" in error ? error.issues : undefined;
  const firstIssue: unknown = Array.isArray(issues) ? issues[0] : undefined;
  const detail =
    typeof firstIssue === "object" && firstIssue !== null && "message" in firstIssue
      ? firstIssue.message
      : undefined;

  return typeof detail === "string" && detail ? `${message} ${detail}` : message;
}

/** Resumen de "Proveedores" cerrada: cuántos hay y quién es el habitual. */
function getSuppliersSectionSummary(
  state: ProductSuppliersFormState,
  isLoaded: boolean,
  product?: ProductWithCategory,
) {
  if (!isLoaded) {
    return product?.preferredSupplier
      ? `Habitual: ${product.preferredSupplier.name}`
      : "Proveedores vinculados, costo y habitual";
  }

  if (state.rows.length === 0) {
    return "Sin proveedores vinculados";
  }

  const preferred = state.rows.find((row) => row.supplierId === state.preferredSupplierId);
  const count = `${state.rows.length} ${state.rows.length === 1 ? "proveedor" : "proveedores"}`;

  return preferred ? `${count} · Habitual: ${preferred.supplierName}` : `${count} · Sin habitual`;
}

type PackUnitProductCreateModalProps = {
  categories: CategoryMock[];
  /** Producto ya guardado, justo antes de cerrar. */
  onCreated: (product: ProductWithCategory) => void;
  /** Solo recibe `false`: el modal pide cerrarse (cancelado, Escape o producto creado). */
  onOpenChange: (open: boolean) => void;
};

/**
 * Alta rápida de un producto componente sin salir del formulario del empaque
 * surtido: el mismo formulario en modo `compact`, que no tiene "Más opciones"
 * (no hay surtido dentro del surtido). Se monta solo mientras está abierta y
 * FUERA del `<form>` del empaque: su envío no debe burbujear al de ese
 * formulario. Guarda con `useCreateProduct`; si el servidor rechaza el alta, el
 * motivo se muestra aquí y el modal sigue abierto.
 */
function PackUnitProductCreateModal({
  categories,
  onCreated,
  onOpenChange,
}: PackUnitProductCreateModalProps) {
  const createProduct = useCreateProduct();

  return (
    <ProductFormModal
      categories={categories}
      compact
      errorMessage={createProduct.error?.message}
      isSubmitting={createProduct.isPending}
      onCreated={onCreated}
      onOpenChange={(open) => {
        if (!open) {
          onOpenChange(false);
        }
      }}
      onSubmit={(input) => createProduct.mutateAsync(input)}
      open
    />
  );
}

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
  pricingChips,
  product: productProp,
  showCreatedToast = !compact,
  suggestedMarkupPct,
  suppliersOnCreate = false,
  trigger,
}: ProductFormModalProps) {
  const { showToast } = useToast();
  const isEdit = !compact && mode === "edit";
  const product = compact ? undefined : productProp;
  const createDefaults = isEdit ? undefined : initialValues;
  const canCreateAnother = !isEdit && !compact;
  const showSuppliers = !compact && (isEdit ? Boolean(product) : suppliersOnCreate);
  const formId = useId();
  const formRef = useRef<HTMLFormElement | null>(null);
  /** El envío en curso lo pidió "Guardar y crear otro" (y no Enter ni el botón principal). */
  const createAnotherRequestedRef = useRef(false);
  // Cambia tras "Guardar y crear otro": el formulario se monta de nuevo y sus
  // campos no controlados (precios, stock, imagen pendiente) vuelven al inicio.
  const [formResetKey, setFormResetKey] = useState(0);
  const isControlled = open !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = isControlled ? open : internalOpen;
  const [name, setName] = useState(product?.name ?? createDefaults?.name ?? "");
  const [sku, setSku] = useState(product?.sku ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
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
  // Chips y semáforo de la tienda; sin datos (cargando, error o 403) valen los por defecto.
  const pricingSettings = usePricingSettings();
  const pricingOptions = getProductPricingOptions(pricingSettings.data);
  const selectedCategory =
    categoryOptions.find((category) => category.id === categoryId) ??
    (product?.category?.id === categoryId ? product.category : undefined);
  const [moreOptionsOpen, setMoreOptionsOpen] = useState(false);
  const [pendingImageBlob, setPendingImageBlob] = useState<Blob | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [packConversionState, setPackConversionState] = useState<PackConversionFormState>(
    createDefaultPackConversionFormState(product?.packConversion),
  );
  const [showSubmitErrors, setShowSubmitErrors] = useState(false);
  const [showPriceRequired, setShowPriceRequired] = useState(false);
  const [stockAdjustmentOpen, setStockAdjustmentOpen] = useState(false);
  const stockAdjustmentTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [packUnitCreateOpen, setPackUnitCreateOpen] = useState(false);
  const packUnitCreateTriggerRef = useRef<HTMLButtonElement | null>(null);
  /** Fila del surtido que recibió el producto recién creado: al cerrar, el foco va a sus unidades. */
  const packUnitCreatedRowKeyRef = useRef<string | null>(null);
  // Candado propio: `isSubmitting` llega con el siguiente render, tarde para un
  // segundo Enter o un clic en el mismo tick.
  const isSubmitInFlightRef = useRef(false);
  // Clave de idempotencia del alta (C6), como en la compra: se conserva mientras
  // se reintenta el MISMO envío (respuesta perdida, 5xx) y se renueva tras el
  // éxito (también con "Guardar y crear otro") y al reabrir el formulario.
  const createAttempt = useRequestAttempt();
  // Último alta que terminó sin respuesta del servidor (red, 5xx): pudo crearse.
  const unansweredCreateRef = useRef<{ fingerprint: string; name: string } | null>(null);
  /** Nombre de ese alta mientras se muestra el aviso de posible duplicado; `null` = sin aviso. */
  const [possibleDuplicateName, setPossibleDuplicateName] = useState<string | null>(null);
  const createAnywayRequestedRef = useRef(false);
  const [failedSubmits, setFailedSubmits] = useState(0);
  const isUnitRole = product?.packConversion?.role === "unit";
  const suppliersBridgeRef = useRef<ProductSuppliersBridgeHandle | null>(null);
  const [suppliersOpen, setSuppliersOpen] = useState(false);
  const [suppliersState, setSuppliersState] = useState<ProductSuppliersFormState>(
    EMPTY_PRODUCT_SUPPLIERS_STATE,
  );
  const [suppliersLoad, setSuppliersLoad] = useState<ProductSuppliersLoad>({
    status: isEdit ? "idle" : "ready",
  });
  /** Cuerpo del `PUT` que dejaría los proveedores como están guardados: si coincide, no se llama. */
  const suppliersBaselineRef = useRef("[]");
  /** Los proveedores ya se cargaron en esta apertura: un refresco posterior no pisa lo editado. */
  const suppliersLoadedRef = useRef(false);
  const [isSavingSuppliers, setIsSavingSuppliers] = useState(false);
  const [suppliersSaveError, setSuppliersSaveError] = useState<string | null>(null);
  /** Alta ya guardada cuyos proveedores fallaron: al reintentar no se vuelve a crear. */
  const [createdProduct, setCreatedProduct] = useState<ProductWithCategory | null>(null);
  const isBusy = isSubmitting || isSavingSuppliers;

  useEffect(() => {
    if (isOpen) {
      // Apertura nueva = intento nuevo: cierra el anterior para estrenar clave.
      createAttempt.succeed();
    }
  }, [createAttempt, isOpen]);

  useEffect(() => {
    if (isOpen) {
      resetFormFields();
    }
    // Reset when opening or when the loaded product payload changes (e.g. detail fetch).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional on open/product.id
  }, [isOpen, product?.id, product?.packConversion?.id]);

  // Antes de que el puente avise de una carga (efecto pasivo de un hijo): un
  // efecto normal correría después y borraría lo recién cargado. No depende del
  // empaque: guardarlo cambia su id con el envío de los proveedores aún en curso.
  useLayoutEffect(() => {
    if (isOpen) {
      resetSuppliers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional on open/product.id
  }, [isOpen, product?.id]);

  function resetSuppliers() {
    suppliersLoadedRef.current = false;
    suppliersBaselineRef.current = "[]";
    setSuppliersOpen(false);
    setSuppliersState(EMPTY_PRODUCT_SUPPLIERS_STATE);
    setSuppliersLoad({ status: isEdit ? "idle" : "ready" });
    setSuppliersSaveError(null);
    setCreatedProduct(null);
  }

  // Edición: los proveedores se piden la primera vez que se despliega su sección.
  function handleSuppliersOpenChange(nextOpen: boolean) {
    setSuppliersOpen(nextOpen);

    if (nextOpen) {
      setSuppliersLoad((current) => (current.status === "idle" ? { status: "loading" } : current));
    }
  }

  function handleSuppliersLoad(event: ProductSuppliersLoadEvent) {
    if (suppliersLoadedRef.current) {
      return;
    }

    if (event.status === "error") {
      setSuppliersLoad({ message: event.message, status: "error" });

      return;
    }

    const loaded = createProductSuppliersState(event.links);

    suppliersLoadedRef.current = true;
    suppliersBaselineRef.current = JSON.stringify(buildProductSuppliersPayload(loaded));
    setSuppliersState(loaded);
    setSuppliersLoad({ status: "ready" });
  }

  function retrySuppliersLoad() {
    setSuppliersLoad({ status: "loading" });
    suppliersBridgeRef.current?.reload();
  }

  function resetFormFields() {
    setName(product?.name ?? createDefaults?.name ?? "");
    setSku(product?.sku ?? "");
    setDescription(product?.description ?? "");
    setCategoryId(product?.categoryId ?? createDefaults?.categoryId ?? "");
    setMoreOptionsOpen(false);
    setPendingImageBlob(null);
    setImageError(null);
    setPackConversionState(createDefaultPackConversionFormState(product?.packConversion));
    setShowSubmitErrors(false);
    setShowPriceRequired(false);
    unansweredCreateRef.current = null;
    setPossibleDuplicateName(null);
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

  function openPackUnitCreate(trigger: HTMLButtonElement) {
    packUnitCreateTriggerRef.current = trigger;
    packUnitCreatedRowKeyRef.current = null;
    setPackUnitCreateOpen(true);
  }

  // El producto creado entra en la receta (primera fila sin producto, o una nueva).
  function handlePackUnitCreated(created: ProductWithCategory) {
    const next = addProductToPackComponents(packConversionState.components, created);

    packUnitCreatedRowKeyRef.current = next.rowKey;
    setPackConversionState((current) => ({ ...current, components: next.components }));
  }

  // Igual que el ajuste de stock: al cerrar, este formulario sigue abierto con
  // lo escrito. Si se creó un producto, el foco va a las unidades de su fila;
  // si no, vuelve al botón que abrió el alta.
  function handlePackUnitCreateOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      return;
    }

    flushSync(() => setPackUnitCreateOpen(false));

    const createdRowKey = packUnitCreatedRowKeyRef.current;
    const unitsField =
      createdRowKey && formRef.current
        ? findPackComponentUnitsField(formRef.current, createdRowKey)
        : null;

    packUnitCreatedRowKeyRef.current = null;
    (unitsField ?? packUnitCreateTriggerRef.current)?.focus();
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

  // "Guardar y crear otro" no es un botón de envío: el navegador elige como
  // botón por defecto el primer `submit` del formulario, y Enter en un campo (o
  // un lector de códigos) lo activaría en vez del principal. Pide el envío él
  // mismo; la marca solo vive durante ese envío, que es síncrono, así que un
  // intento frenado por la validación nativa no la deja puesta.
  function submitAndCreateAnother() {
    createAnotherRequestedRef.current = true;

    try {
      formRef.current?.requestSubmit();
    } finally {
      createAnotherRequestedRef.current = false;
    }
  }

  // "Crear de todos modos": el usuario ya revisó la lista y decide que lo
  // escrito es otro producto. La marca se lee al empezar el envío.
  function submitCreateAnyway() {
    createAnywayRequestedRef.current = true;

    try {
      formRef.current?.requestSubmit();
    } finally {
      createAnywayRequestedRef.current = false;
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>, close: () => void) {
    event.preventDefault();

    if (isBusy || isSubmitInFlightRef.current) {
      return;
    }

    const form = event.currentTarget;
    const createAnother = canCreateAnother && createAnotherRequestedRef.current;
    const createAnyway = createAnywayRequestedRef.current;
    const formData = new FormData(form);

    // El precio es obligatorio, como cuando el campo era `required`: vacío no
    // se envía (ni se convierte en 0), se avisa en el campo y recibe el foco.
    if (formData.get("salePriceRef") === "") {
      flushSync(() => setShowPriceRequired(true));
      form
        .querySelector<HTMLInputElement>(
          `[${PRODUCT_PRICING_BLOCK_ATTRIBUTE}] input[aria-invalid="true"]`,
        )
        ?.focus();

      return;
    }

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

    // Surtido: filas sin producto o sin unidades, producto repetido, menos de 2
    // productos, peso que no vale o suma distinta del total declarado.
    const assortedErrors =
      shouldSendPackConversion &&
      packConversionState.enabled &&
      packConversionState.mode === "assorted"
        ? getAssortedPackErrors(packConversionState)
        : undefined;

    if (assortedErrors) {
      // Los avisos se pintan antes de buscar el campo: un peso que no vale abre "Avanzado".
      flushSync(() => {
        setMoreOptionsOpen(true);
        setShowSubmitErrors(true);
      });
      findAssortedInvalidField(
        form,
        assortedErrors,
        packConversionState.components,
        UNITS_PER_PACK_FIELD_NAME,
      )?.focus();

      return;
    }

    // Proveedores: costo que no vale o más de los que admite un producto.
    const suppliersErrors = showSuppliers ? getProductSuppliersErrors(suppliersState) : undefined;

    if (suppliersErrors) {
      flushSync(() => {
        setMoreOptionsOpen(true);
        setSuppliersOpen(true);
        setShowSubmitErrors(true);
      });
      findProductSuppliersInvalidField(form, suppliersErrors)?.focus();

      return;
    }

    // Solo se guardan si la sección cambió respecto de lo cargado.
    const suppliersPayload = buildProductSuppliersPayload(suppliersState);
    const suppliersSnapshot = JSON.stringify(suppliersPayload);
    const shouldSaveSuppliers =
      showSuppliers &&
      suppliersLoad.status === "ready" &&
      suppliersSnapshot !== suppliersBaselineRef.current;

    // La descripción solo viaja si cambió respecto de la guardada (en un alta,
    // si se escribió): sin tocarla, la edición conserva la que tiene el
    // producto. Vaciarla viaja como `null`, que la borra.
    const descriptionText = cleanText(description);
    const descriptionChanged = descriptionText !== cleanText(product?.description ?? "");

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
      ...(!compact && descriptionChanged ? { description: descriptionText || null } : {}),
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

    // Alta sin respuesta y contenido cambiado: la misma clave con otro cuerpo es
    // un 409 del servidor que no se puede reintentar, y una clave nueva podría
    // duplicar el producto. No se envía: se avisa y decide el usuario. Si deja
    // lo escrito como estaba, el reintento viaja con la misma clave.
    const createFingerprint = JSON.stringify(input);
    const unansweredCreate = createdProduct ? null : unansweredCreateRef.current;

    if (unansweredCreate && unansweredCreate.fingerprint !== createFingerprint) {
      if (!createAnyway) {
        setPossibleDuplicateName(unansweredCreate.name);

        return;
      }

      // Otro producto: se cierra el intento anterior para estrenar clave.
      createAttempt.succeed();
      unansweredCreateRef.current = null;
    }

    setPossibleDuplicateName(null);

    // Si `onSubmit` rechaza, no se llega a `close()`: el modal queda abierto con
    // lo escrito. El rechazo se queda aquí (no sube como promesa sin manejar):
    // el motivo lo pinta el consumidor con `errorMessage`.
    // El candado cubre también el guardado de los proveedores.
    isSubmitInFlightRef.current = true;

    try {
      let created: ProductWithCategory | undefined = createdProduct ?? undefined;

      // Un alta cuyos proveedores fallaron ya está creada: solo se reintentan ellos.
      if (!createdProduct) {
        // Solo el alta lleva clave; `null` = ya hay un envío en vuelo.
        const clientRequestId = isEdit ? undefined : createAttempt.begin(input);

        if (clientRequestId === null) {
          return;
        }

        try {
          created =
            (await onSubmit?.(clientRequestId ? { ...input, clientRequestId } : input, {
              pendingImageBlob,
            })) ?? undefined;
        } catch (error) {
          createAttempt.fail(error);
          unansweredCreateRef.current =
            !isEdit && isUnansweredRequest(error)
              ? { fingerprint: createFingerprint, name: input.name }
              : null;
          setFailedSubmits((count) => count + 1);

          return;
        }

        createAttempt.succeed();
        unansweredCreateRef.current = null;

        if (!isEdit && created) {
          onCreated?.(created);
        }

        if (!isEdit && showCreatedToast) {
          showToast({
            action: created ? { href: `/products/${created.id}`, label: "Ver" } : undefined,
            title: `Producto creado: ${created?.name ?? input.name}`,
            tone: "success",
          });
        }
      }

      if (shouldSaveSuppliers) {
        const targetId = isEdit ? product?.id : created?.id;
        const bridge = suppliersBridgeRef.current;

        if (!targetId || !bridge) {
          // `onSubmit` no devolvió el producto: sin su id no hay a quién vincularlos,
          // y dejar el modal abierto invitaría a crearlo otra vez.
          showToast({
            title: "Los proveedores no se guardaron: añádelos desde el detalle del producto.",
            tone: "error",
          });
        } else {
          let result: SaveProductSuppliersResult;

          setSuppliersSaveError(null);
          setIsSavingSuppliers(true);

          try {
            result = await bridge.save(targetId, suppliersPayload);
          } catch (error) {
            setSuppliersSaveError(getSuppliersSaveErrorReason(error));
            setMoreOptionsOpen(true);
            setSuppliersOpen(true);

            if (!isEdit && created) {
              setCreatedProduct(created);
            }

            return;
          } finally {
            setIsSavingSuppliers(false);
          }

          suppliersBaselineRef.current = suppliersSnapshot;

          // El servidor dejó un habitual distinto del que mostraba el formulario.
          if (result.preferredSupplierId !== suppliersState.preferredSupplierId) {
            const preferred = result.suppliers.find(
              (link) => link.supplierId === result.preferredSupplierId,
            );

            showToast({
              title: preferred
                ? `El habitual pasó a ${preferred.supplierName}`
                : "El producto quedó sin proveedor habitual",
              tone: "info",
            });
          }
        }
      }
    } finally {
      isSubmitInFlightRef.current = false;
    }

    if (!createAnother) {
      close();

      return;
    }

    flushSync(() => {
      resetFormFields();
      resetSuppliers();
      setCategoryId(input.categoryId ?? "");
      setFormResetKey((key) => key + 1);
    });

    const nameField = formRef.current?.elements.namedItem("name");

    if (nameField instanceof HTMLElement) {
      nameField.focus();
    }
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
      footer={({ close }) =>
        canCreateAnother ? (
          // FormActions no admite una acción secundaria entre Cancelar y la principal.
          <>
            <Button onClick={close} variant="outline">
              Cancelar
            </Button>
            <Button disabled={isBusy} onClick={submitAndCreateAnother} variant="outline">
              Guardar y crear otro
            </Button>
            <Button disabled={isBusy} form={formId} type="submit">
              {isBusy ? "Guardando..." : createdProduct ? "Guardar proveedores" : "Crear producto"}
            </Button>
          </>
        ) : (
          <FormActions
            isSubmitting={isBusy || isUploadingImage}
            onCancel={close}
            submitFormId={formId}
            submitLabel={isEdit ? "Guardar cambios" : "Crear producto"}
          />
        )
      }
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
        key={formResetKey}
        onInvalidCapture={handleInvalidCapture}
        onSubmit={(event) => handleSubmit(event, () => handleOpenChange(false))}
        ref={formRef}
      >
        {/* Alta ya guardada: lo básico queda inerte, el producto no se vuelve a enviar. */}
        <div className="contents" inert={Boolean(createdProduct)}>
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
            pricingChips={pricingChips ?? pricingOptions.chips}
            showPriceRequired={showPriceRequired}
            suggestedMarkupPct={
              suggestedMarkupPct ?? selectedCategory?.defaultMarkupPct ?? undefined
            }
            thresholds={pricingOptions.thresholds}
          />
        </div>
        {compact ? (
          <p className="text-sm text-on-surface-variant">
            Se crea con lo básico y el SKU se genera solo. El stock, el empaque y la imagen se
            completan después desde Productos.
          </p>
        ) : (
          <ProductFormMoreOptions
            description={description}
            isEdit={isEdit}
            isUnitRole={isUnitRole}
            onAdjustStock={isEdit && product ? openStockAdjustment : undefined}
            onCreatePackUnitProduct={openPackUnitCreate}
            onDescriptionChange={setDescription}
            onOpenChange={setMoreOptionsOpen}
            onPackConversionChange={(patch) =>
              setPackConversionState((current) => ({ ...current, ...patch }))
            }
            onSkuChange={setSku}
            open={moreOptionsOpen}
            packConversionState={packConversionState}
            product={product}
            productLocked={Boolean(createdProduct)}
            productName={name}
            showErrors={showSubmitErrors}
            sku={sku}
            suppliers={
              showSuppliers ? (
                <CollapsibleSection
                  className="min-w-0"
                  onOpenChange={handleSuppliersOpenChange}
                  open={suppliersOpen}
                  summary={
                    <span className="block truncate">
                      {getSuppliersSectionSummary(
                        suppliersState,
                        suppliersLoad.status === "ready",
                        product,
                      )}
                    </span>
                  }
                  title="Proveedores"
                >
                  <ProductSuppliersFields
                    isLoading={
                      suppliersLoad.status === "idle" || suppliersLoad.status === "loading"
                    }
                    loadError={suppliersLoad.status === "error" ? suppliersLoad.message : undefined}
                    onChange={setSuppliersState}
                    onRetryLoad={retrySuppliersLoad}
                    showErrors={showSubmitErrors}
                    state={suppliersState}
                  />
                </CollapsibleSection>
              ) : undefined
            }
            suppliersCount={
              isEdit && suppliersLoad.status !== "ready" ? undefined : suppliersState.rows.length
            }
            unitSearchResetKey={failedSubmits}
          />
        )}
        {suppliersSaveError ? (
          <p
            className="break-words rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
            role="alert"
          >
            El producto se guardó, pero los proveedores no: {suppliersSaveError}
            {createdProduct
              ? " Corrige los proveedores y vuelve a guardar: el producto ya está creado y no se creará otra vez."
              : ""}
          </p>
        ) : null}
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
        {possibleDuplicateName !== null ? (
          <div
            className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200"
            role="alert"
          >
            <p>{POSSIBLE_DUPLICATE_MESSAGE}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
              <a
                className="font-medium underline underline-offset-2"
                href={`/products?search=${encodeURIComponent(possibleDuplicateName)}`}
                rel="noopener noreferrer"
                target="_blank"
              >
                Buscar en la lista
              </a>
              <Button disabled={isBusy} onClick={submitCreateAnyway} size="sm" variant="outline">
                Crear de todos modos
              </Button>
            </div>
          </div>
        ) : null}
      </form>
      {showSuppliers && isOpen && suppliersLoad.status !== "idle" ? (
        <ProductSuppliersBridge
          loadProductId={isEdit ? product?.id : undefined}
          onLoad={handleSuppliersLoad}
          ref={suppliersBridgeRef}
        />
      ) : null}
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
      {/* Fuera del <form>: crear el producto componente no debe enviar el empaque. */}
      {packUnitCreateOpen ? (
        <PackUnitProductCreateModal
          categories={categoryOptions}
          onCreated={handlePackUnitCreated}
          onOpenChange={handlePackUnitCreateOpenChange}
        />
      ) : null}
    </Modal>
  );
}
