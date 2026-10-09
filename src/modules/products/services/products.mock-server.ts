import { ApiError } from "@/lib/api/apiError";
import { assertMockStoreResource } from "@/lib/api/assertStoreResource";
import { paginateList } from "@/lib/api/pagination";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";
import {
  mockCategories,
  mockProductPackConversions,
  mockProductPriceHistory,
  mockProducts,
  mockSaleItems,
  mockSales,
  mockStockMovements,
  type ProductMock,
  type ProductPackComponentMock,
  type ProductPackConversionMock,
} from "@/shared/mocks/erp-data";
import { mockState } from "@/shared/mocks/mockStore";
import { getPricingSettings } from "@/modules/settings/services/settings.mock-server";
import { generateProductSkuFromName, normalizeSku } from "@/shared/utils/skuGeneration";

import { parsePackLinkFilter, type PackConversionInput } from "./packConversionSchemas";
import { isPriceReviewFilterOn, type ProductPriceHistoryEntry } from "./priceReview";
import {
  assertMockExpectedCost,
  attachMockPriceReview,
  ensureMockPriceBaselines,
  recordMockPriceChange,
  toMockPriceHistoryEntry,
} from "./priceReview.mock-server";
import {
  buildMockPackRecipe,
  buildPackConversionListItem,
  buildPackConversionSummary,
  isSamePackRecipe,
  type PackRecipeProduct,
  type PackRecipeView,
} from "./packConversionSummary";
import {
  buildGeneratedSku,
  GENERATED_SKU_EXHAUSTED_MESSAGE,
  GENERATED_SKU_MAX_ATTEMPTS,
} from "./productSku";
import {
  getProductMarginThresholds,
  matchesProductMarginFilter,
  parseProductMarginFilter,
} from "./productMargin";
import {
  buildProductCreateFingerprint,
  PRODUCT_CATEGORY_INACTIVE_MESSAGE,
  PRODUCT_CATEGORY_NOT_IN_STORE_MESSAGE,
  PRODUCT_CATEGORY_REQUIRED_MESSAGE,
  PRODUCT_CREATE_REQUEST_REUSED_MESSAGE,
  PRODUCT_EDIT_PRICE_REASON,
} from "./productSchemas";
import { assertListFilterParams } from "./listFilterParams";
import { parseProductSort, sortProductItems } from "./productSort";
import {
  isUnsearchableSearchTerm,
  matchesProductSearch,
  matchesExactBarcode,
  normalizeBarcode,
  normalizeProductSearch,
} from "./productSearch";
import { buildProductSaleHistoryResult, joinProductSaleItems } from "./productSales";

export type ProductInput = Partial<
  Pick<
    ProductMock,
    | "barcode"
    | "categoryId"
    | "currentCostRef"
    | "currentStock"
    | "description"
    | "imageUrl"
    | "isActive"
    | "minStock"
    | "name"
    | "salePriceRef"
    | "sku"
  >
> & {
  /** Solo en el alta: clave de idempotencia del envío (uuid). */
  clientRequestId?: string;
  packConversion?: PackConversionInput;
};

export type ProductPriceInput = Pick<ProductMock, "salePriceRef"> & {
  /** Costo que vio el usuario: si el producto ya cuesta otra cosa, 409 sin cambiar el precio. */
  expectedCostRef?: number;
  /** Motivo del cambio; ausente o `null` = sin motivo (`p_reason` nulo en la RPC). */
  reason?: string | null;
};

export type { ProductPriceHistoryEntry };

/**
 * Como `assertProductCategory` del server: la categoría de un alta o de un
 * cambio de categoría existe, es de la tienda y está activa; vacía no se admite.
 */
function assertMockProductCategory(categoryId: string, storeId: string) {
  if (!categoryId.trim()) {
    throw new ApiError(400, "BAD_REQUEST", PRODUCT_CATEGORY_REQUIRED_MESSAGE);
  }

  const category = mockCategories.find(
    (item) => item.id === categoryId && (item.storeId ?? DEFAULT_STORE_ID) === storeId,
  );

  if (!category) {
    throw new ApiError(400, "BAD_REQUEST", PRODUCT_CATEGORY_NOT_IN_STORE_MESSAGE);
  }

  if (!category.isActive) {
    throw new ApiError(400, "BAD_REQUEST", PRODUCT_CATEGORY_INACTIVE_MESSAGE);
  }
}

/** Precio REF a dos decimales, como lo compara el server. */
function roundPriceRef(value: number) {
  return Math.round(value * 100) / 100;
}

function toMockRecipeProduct(product: ProductMock): PackRecipeProduct {
  return {
    currentCostRef: product.currentCostRef,
    currentStock: product.currentStock,
    id: product.id,
    isActive: product.isActive !== false,
    name: product.name,
    salePriceRef: product.salePriceRef,
    sku: product.sku,
  };
}

/** `undefined` si falta el empaque o algún producto componente, como en el server. */
function toMockRecipeView(link: ProductPackConversionMock): PackRecipeView | undefined {
  const packProduct = mockProducts.find((item) => item.id === link.packProductId);
  const components = link.components.flatMap((component) => {
    const product = mockProducts.find((item) => item.id === component.unitProductId);

    return product
      ? [
          {
            costWeight: component.costWeight,
            product: toMockRecipeProduct(product),
            unitsPerPack: component.unitsPerPack,
          },
        ]
      : [];
  });

  if (!packProduct || components.length === 0 || components.length !== link.components.length) {
    return undefined;
  }

  return {
    ...(link.alwaysDisassembleOnReceive === true ? { alwaysDisassembleOnReceive: true } : {}),
    components,
    id: link.id,
    label: link.label ?? null,
    packProduct: toMockRecipeProduct(packProduct),
    totalUnits: link.totalUnits,
  };
}

function activeMockRecipes(storeId: string) {
  return mockProductPackConversions.filter((item) => item.isActive && item.storeId === storeId);
}

function resolvePackConversion(productId: string, storeId: string) {
  const recipes = activeMockRecipes(storeId);
  const packLink = recipes.find((item) => item.packProductId === productId);

  return buildPackConversionSummary({
    packRecipe: packLink ? toMockRecipeView(packLink) : undefined,
    productId,
    sourceRecipes: recipes
      .filter((item) => item.components.some((component) => component.unitProductId === productId))
      .flatMap((item) => {
        const recipe = toMockRecipeView(item);

        return recipe ? [recipe] : [];
      }),
  });
}

/**
 * Como `packConversion.server`: una unidad / componente puede salir de varios
 * empaques, pero no puede ser el EMPAQUE de una receta activa.
 */
function assertMockUnitAvailable(
  unitProductId: string,
  storeId: string,
  packProductId: string | null,
) {
  const unit = mockProducts.find((item) => item.id === unitProductId);
  assertMockStoreResource(unit, storeId, "Producto unidad no encontrado.");

  if (unitProductId === packProductId) {
    throw new ApiError(400, "BAD_REQUEST", "El empaque y la unidad deben ser productos distintos.");
  }

  if (activeMockRecipes(storeId).some((item) => item.packProductId === unitProductId)) {
    throw new ApiError(
      409,
      "CONFLICT",
      "El producto unidad es un empaque con receta activa: no puede salir de otro empaque.",
    );
  }
}

function assertMockComponentsAvailable(
  unitProductIds: string[],
  storeId: string,
  packProductId: string | null,
) {
  if (packProductId !== null && unitProductIds.includes(packProductId)) {
    throw new ApiError(400, "BAD_REQUEST", "El empaque no puede ser componente de sí mismo.");
  }

  const allInStore = unitProductIds.every((id) =>
    mockProducts.some(
      (product) => product.id === id && (product.storeId ?? DEFAULT_STORE_ID) === storeId,
    ),
  );

  if (!allInStore) {
    throw new ApiError(404, "NOT_FOUND", "Producto componente no encontrado.");
  }

  if (activeMockRecipes(storeId).some((item) => unitProductIds.includes(item.packProductId))) {
    throw new ApiError(
      409,
      "CONFLICT",
      "Un componente es un empaque con receta activa: no puede salir de otro empaque.",
    );
  }
}

/**
 * Como `assertPackIsNotComponent` del server: un producto que ya sale de un
 * empaque (componente de una receta activa) no puede estrenar receta propia. El
 * que ya tiene receta activa (datos anteriores a la regla) la sigue editando.
 */
function assertMockPackIsNotComponent(packProductId: string, storeId: string) {
  const recipes = activeMockRecipes(storeId);

  if (recipes.some((item) => item.packProductId === packProductId)) {
    return;
  }

  const source = recipes.find((item) =>
    item.components.some((component) => component.unitProductId === packProductId),
  );

  if (!source) {
    return;
  }

  const packName = mockProducts.find((product) => product.id === source.packProductId)?.name;

  throw new ApiError(
    409,
    "CONFLICT",
    `Este producto ya es unidad de ${packName?.trim() || "otro empaque"}; no puede ser a la vez un empaque.`,
  );
}

/**
 * Receta nueva para el empaque; la vigente queda inactiva. Como el server, una
 * receta distinta nunca se edita en sitio: la anterior conserva la historia.
 */
function replaceMockRecipe(
  packProductId: string,
  storeId: string,
  recipe: { components: ProductPackComponentMock[]; label?: string | null; totalUnits: number },
) {
  for (const link of mockProductPackConversions) {
    if (link.packProductId === packProductId && link.storeId === storeId) {
      link.isActive = false;
    }
  }

  mockProductPackConversions.push(
    buildMockPackRecipe({
      components: recipe.components,
      // El índice evita ids repetidos al reemplazar una receta en el mismo milisegundo.
      id: `ppc-${Date.now()}-${mockProductPackConversions.length}`,
      isActive: true,
      label: recipe.label,
      packProductId,
      storeId,
      totalUnits: recipe.totalUnits,
    }),
  );
}

function upsertMockAssortedRecipe(
  packProductId: string,
  storeId: string,
  input: PackConversionInput,
) {
  const components = (input.components ?? []).map((component) => ({
    costWeight: component.costWeight,
    unitProductId: component.unitProductId,
    unitsPerPack: component.unitsPerPack,
  }));
  const totalUnits = input.totalUnits ?? 0;
  const label = input.label?.trim() || null;

  assertMockComponentsAvailable(
    components.map((component) => component.unitProductId),
    storeId,
    packProductId,
  );

  const existing = activeMockRecipes(storeId).find((item) => item.packProductId === packProductId);

  if (existing && isSamePackRecipe(existing, { components, totalUnits })) {
    existing.label = label;
    return;
  }

  replaceMockRecipe(packProductId, storeId, { components, label, totalUnits });
}

/** Nombre y SKU del producto unidad que crea el modo `create_unit`. */
function resolveMockNewUnitIdentity(input: PackConversionInput, packName: string) {
  const name = input.unitProduct?.name?.trim() || `${packName} (unidad)`;

  return {
    name,
    sku: normalizeSku(input.unitProduct?.sku ?? "") || generateProductSkuFromName(name),
  };
}

/**
 * Como `assertPackConversionCanBeCreated` del server: lo que se comprueba de una
 * receta ANTES de crear su empaque, para que un alta con una receta inválida no
 * deje el producto creado.
 */
function assertMockPackConversionCanBeCreated(
  storeId: string,
  input: PackConversionInput,
  packProduct: { name: string; sku: string },
) {
  if (!input.enabled) {
    return;
  }

  if (input.mode === "assorted") {
    assertMockComponentsAvailable(
      (input.components ?? []).map((component) => component.unitProductId),
      storeId,
      null,
    );
    return;
  }

  if (input.mode === "link_existing") {
    if (!input.unitProductId) {
      throw new ApiError(400, "BAD_REQUEST", "Selecciona el producto unidad.");
    }

    assertMockUnitAvailable(input.unitProductId, storeId, null);
    return;
  }

  const unit = resolveMockNewUnitIdentity(input, packProduct.name);

  if (unit.sku === packProduct.sku || mockProducts.some((product) => product.sku === unit.sku)) {
    throw new ApiError(409, "CONFLICT", "Ya existe un producto con este SKU de unidad.");
  }
}

/**
 * Guarda la receta y deja en la receta ACTIVA la preferencia «Desarmar siempre
 * al recibir compras» (COM-14), como el server: la que llega o, si no llega, la
 * de la receta que había (una receta reemplazada no la pierde).
 */
function upsertMockPackConversion(
  packProductId: string,
  storeId: string,
  input: PackConversionInput,
  packProduct: ProductMock,
) {
  const findActive = () =>
    activeMockRecipes(storeId).find((item) => item.packProductId === packProductId);
  const alwaysDisassemble =
    input.alwaysDisassembleOnReceive ?? findActive()?.alwaysDisassembleOnReceive === true;

  saveMockPackRecipe(packProductId, storeId, input, packProduct);

  const active = input.enabled ? findActive() : undefined;

  if (!active) {
    return;
  }

  if (alwaysDisassemble) {
    active.alwaysDisassembleOnReceive = true;
  } else {
    delete active.alwaysDisassembleOnReceive;
  }
}

function saveMockPackRecipe(
  packProductId: string,
  storeId: string,
  input: PackConversionInput,
  packProduct: ProductMock,
) {
  if (!input.enabled) {
    for (const link of mockProductPackConversions) {
      if (link.packProductId === packProductId && link.storeId === storeId) {
        link.isActive = false;
      }
    }
    return;
  }

  assertMockPackIsNotComponent(packProductId, storeId);

  if (input.mode === "assorted") {
    upsertMockAssortedRecipe(packProductId, storeId, input);
    return;
  }

  const unitsPerPack = input.unitsPerPack ?? 2;
  let unitProductId = input.unitProductId;

  if (input.mode === "link_existing") {
    if (!unitProductId) {
      throw new ApiError(400, "BAD_REQUEST", "Selecciona el producto unidad.");
    }

    assertMockUnitAvailable(unitProductId, storeId, packProductId);
  } else {
    const { name: unitName, sku: unitSku } = resolveMockNewUnitIdentity(input, packProduct.name);
    const unitCost =
      input.unitProduct?.currentCostRef ??
      Number(((packProduct.currentCostRef ?? 0) / unitsPerPack).toFixed(2));

    if (mockProducts.some((product) => product.sku === unitSku)) {
      throw new ApiError(409, "CONFLICT", "Ya existe un producto con este SKU de unidad.");
    }

    const unitProduct: ProductMock = {
      barcode: normalizeBarcode(input.unitProduct?.barcode),
      categoryId: packProduct.categoryId,
      currentCostRef: unitCost,
      currentStock: 0,
      id: `prod-unit-${Date.now()}`,
      isActive: true,
      minStock: 5,
      name: unitName,
      salePriceRef: input.unitProduct?.salePriceRef ?? 0,
      sku: unitSku,
      storeId,
    };
    mockProducts.push(unitProduct);
    unitProductId = unitProduct.id;
  }

  const existing = activeMockRecipes(storeId).find((item) => item.packProductId === packProductId);
  const existingComponent = existing?.components[0];

  // Mismo producto unidad: se edita en sitio y el componente conserva su peso.
  if (existing && existingComponent && existing.unitProductId === unitProductId) {
    existingComponent.unitsPerPack = unitsPerPack;
    existing.totalUnits = unitsPerPack;
    existing.unitsPerPack = unitsPerPack;
    return;
  }

  replaceMockRecipe(packProductId, storeId, {
    components: [{ costWeight: 1, unitProductId: unitProductId!, unitsPerPack }],
    totalUnits: unitsPerPack,
  });
}

export function listProducts(searchParams: URLSearchParams, storeId: string) {
  assertListFilterParams(searchParams, ["barcode", "categoryId", "sku"]);

  const barcode = normalizeBarcode(searchParams.get("barcode"));
  const categoryId = searchParams.get("categoryId");
  const isActive = searchParams.get("isActive");
  const search = normalizeProductSearch(searchParams.get("search"));
  // Como en el servicio real: un término de solo comodines no casa con nada.
  const unsearchable = isUnsearchableSearchTerm(searchParams.get("search"));
  const sku = normalizeSku(searchParams.get("sku") ?? "");
  // `packLink=not-pack`: fuera los empaques de una receta activa. `packLink=none`:
  // fuera también sus componentes (sin ningún vínculo de empaque).
  const packLink = parsePackLinkFilter(searchParams);
  const packLinkedIds = new Set(
    packLink
      ? activeMockRecipes(storeId).flatMap((link) => [
          link.packProductId,
          ...(packLink === "none"
            ? link.components.map((component) => component.unitProductId)
            : []),
        ])
      : [],
  );

  const marginFilter = parseProductMarginFilter(searchParams);
  const marginThresholds = getProductMarginThresholds(getPricingSettings(storeId));

  const products = mockProducts.filter((product) => {
    const matchesBarcode = !barcode || matchesExactBarcode(product, barcode);
    const matchesSku = !sku || product.sku === sku;
    const matchesSearch =
      barcode || sku || (!unsearchable && (!search || matchesProductSearch(product, search)));
    const matchesCategory = !categoryId || product.categoryId === categoryId;
    const matchesActive =
      isActive === null || product.isActive === (isActive.toLowerCase() === "true");

    return (
      (product.storeId ?? DEFAULT_STORE_ID) === storeId &&
      matchesBarcode &&
      matchesSku &&
      matchesSearch &&
      matchesCategory &&
      matchesActive &&
      matchesProductMarginFilter(product, marginFilter, marginThresholds) &&
      !packLinkedIds.has(product.id)
    );
  });

  // `priceReview` solo en los productos de la cola "Por revisar"; `review=1` deja solo esos.
  const reviewOnly = isPriceReviewFilterOn(searchParams);
  const items = attachMockPriceReview(products)
    .filter((product) => !reviewOnly || product.priceReview !== undefined)
    .map((product) => {
      const category = mockCategories.find((item) => item.id === product.categoryId);
      return {
        ...product,
        category,
        taxRate: product.taxRate ?? category?.taxRate ?? 0,
      };
    });

  const { sortBy, sortOrder } = parseProductSort(searchParams);
  const sortedItems = sortProductItems(items, sortBy, sortOrder);

  return paginateList(sortedItems, searchParams);
}

export function getProductById(id: string, storeId: string) {
  const product = mockProducts.find((item) => item.id === id);
  assertMockStoreResource(product, storeId, "Producto no encontrado.");

  const packConversion = resolvePackConversion(id, storeId);

  return {
    ...attachMockPriceReview([product])[0],
    category: mockCategories.find((category) => category.id === product.categoryId),
    ...(packConversion ? { packConversion } : {}),
  };
}

/**
 * SKU del alta, igual que el server: el escrito (409 si ya existe) o, sin él,
 * uno generado desde el nombre que reintenta con sufijo mientras choque.
 */
function resolveCreateSku(input: ProductInput) {
  const isTaken = (sku: string) => mockProducts.some((product) => product.sku === sku);
  const requestedSku = normalizeSku(input.sku ?? "");

  if (requestedSku) {
    if (isTaken(requestedSku)) {
      throw new ApiError(409, "CONFLICT", "Ya existe un producto con este SKU.");
    }

    return requestedSku;
  }

  for (let attempt = 0; attempt < GENERATED_SKU_MAX_ATTEMPTS; attempt += 1) {
    const sku = buildGeneratedSku(input.name ?? "", attempt);

    if (!isTaken(sku)) {
      return sku;
    }
  }

  throw new ApiError(409, "CONFLICT", GENERATED_SKU_EXHAUSTED_MESSAGE);
}

/**
 * Como el índice `products_store_barcode_unique` de la base: un código de barras no vacío
 * por tienda. El server guarda el código recortado (`normalizeBarcode`) y responde al
 * 23505 con este mismo 409. `exceptId` = el producto que se edita (puede reenviar el suyo).
 */
function assertMockBarcodeIsFree(
  barcode: string | null | undefined,
  storeId: string,
  exceptId?: string,
) {
  const normalized = normalizeBarcode(barcode);

  if (
    normalized &&
    mockProducts.some(
      (product) =>
        product.id !== exceptId &&
        // Los productos de la semilla no traen tienda: son de la tienda por defecto.
        (product.storeId ?? DEFAULT_STORE_ID) === storeId &&
        normalizeBarcode(product.barcode) === normalized,
    )
  ) {
    throw new ApiError(409, "CONFLICT", "El recurso ya existe.");
  }
}

/**
 * Altas ya hechas por clave de idempotencia (`storeId:clientRequestId`), como el
 * índice único `products_store_client_request_unique` de la base.
 */
function productsByCreateRequest() {
  return mockState(
    "products:byCreateRequest",
    () => new Map<string, { fingerprint: string; productId: string }>(),
  );
}

export function createProduct(input: ProductInput, storeId: string) {
  const { clientRequestId, ...content } = input;
  const requestKey = clientRequestId ? `${storeId}:${clientRequestId}` : null;
  const fingerprint = buildProductCreateFingerprint(content);
  const previous = requestKey ? productsByCreateRequest().get(requestKey) : undefined;

  // Como el server: el reintento del mismo alta devuelve el producto ya creado,
  // sin otro producto ni otro `inventario_inicial`; la clave con otro contenido, 409.
  if (previous) {
    if (previous.fingerprint !== fingerprint) {
      throw new ApiError(409, "CONFLICT", PRODUCT_CREATE_REQUEST_REUSED_MESSAGE);
    }

    return getProductById(previous.productId, storeId);
  }

  if (input.categoryId !== undefined) {
    assertMockProductCategory(input.categoryId, storeId);
  }

  const sku = resolveCreateSku(input);
  const name = input.name ?? "Producto mock";

  // Como el server: la receta se valida antes de crear nada.
  if (input.packConversion) {
    assertMockPackConversionCanBeCreated(storeId, input.packConversion, { name, sku });
  }

  // Como el server: lo decide el índice al insertar, después de validar lo demás.
  assertMockBarcodeIsFree(input.barcode, storeId);

  const product: ProductMock = {
    barcode: normalizeBarcode(input.barcode),
    categoryId: input.categoryId ?? "cat-tools",
    currentCostRef: input.currentCostRef ?? 0,
    currentStock: 0,
    description: input.description ?? null,
    // El índice evita ids repetidos al crear varios productos en el mismo milisegundo.
    id: `prod-mock-${Date.now()}-${mockProducts.length}`,
    imageUrl: input.imageUrl ?? undefined,
    isActive: true,
    minStock: input.minStock ?? 5,
    name,
    salePriceRef: input.salePriceRef ?? 0,
    sku,
    storeId,
  };

  mockProducts.push(product);

  if (requestKey) {
    productsByCreateRequest().set(requestKey, { fingerprint, productId: product.id });
  }

  // Como el trigger de las altas: el producto nace con su línea base de ganancia.
  ensureMockPriceBaselines();

  // Igual que el server: el stock inicial entra como movimiento `inventario_inicial`.
  const initialStock = input.currentStock ?? 0;

  if (initialStock > 0) {
    product.currentStock = initialStock;
    mockStockMovements.unshift({
      createdAt: new Date().toISOString(),
      id: `mov-mock-${Date.now()}`,
      productId: product.id,
      quantityDelta: initialStock,
      reason: "Inventario inicial al crear el producto",
      stockAfter: initialStock,
      storeId,
      type: "inventario_inicial",
    });
  }

  if (input.packConversion) {
    upsertMockPackConversion(product.id, storeId, input.packConversion, product);
  }

  return getProductById(product.id, storeId);
}

export function updateProduct(id: string, input: ProductInput, storeId: string) {
  // SKU vacío = se conserva el actual: ni se borra ni se regenera.
  const sku = normalizeSku(input.sku ?? "");

  if (sku && mockProducts.some((product) => product.id !== id && product.sku === sku)) {
    throw new ApiError(409, "CONFLICT", "Ya existe un producto con este SKU.");
  }

  const product = mockProducts.find((item) => item.id === id);
  assertMockStoreResource(product, storeId, "Producto no encontrado.");

  // Como el server: la categoría que ya tiene se puede reenviar; otra se valida.
  if (input.categoryId !== undefined && input.categoryId !== product.categoryId) {
    assertMockProductCategory(input.categoryId, storeId);
  }

  assertMockBarcodeIsFree(input.barcode, storeId, id);

  // La línea base guarda el costo ANTES de esta edición.
  ensureMockPriceBaselines();

  if (input.barcode !== undefined) product.barcode = normalizeBarcode(input.barcode);
  if (input.categoryId !== undefined) product.categoryId = input.categoryId;
  if (input.currentCostRef !== undefined) product.currentCostRef = input.currentCostRef;
  // El stock solo cambia por movimientos (ventas, ajustes, compras), nunca por PATCH.
  if (input.description !== undefined) product.description = input.description;
  if (input.imageUrl !== undefined) product.imageUrl = input.imageUrl ?? undefined;
  if (input.isActive !== undefined) product.isActive = input.isActive;
  if (input.minStock !== undefined) product.minStock = input.minStock;
  if (input.name !== undefined) product.name = input.name;
  if (sku) product.sku = sku;

  if (input.packConversion) {
    upsertMockPackConversion(id, storeId, input.packConversion, product);
  }

  // Como el server: el precio va al final y solo si cambia, por la misma vía que
  // `POST …/price` (entrada de historial con la instantánea del costo ya guardado).
  if (
    input.salePriceRef !== undefined &&
    roundPriceRef(input.salePriceRef) !== roundPriceRef(product.salePriceRef)
  ) {
    recordMockPriceChange(product, {
      reason: PRODUCT_EDIT_PRICE_REASON,
      salePriceRef: input.salePriceRef,
    });
    product.salePriceRef = input.salePriceRef;
  }

  return getProductById(id, storeId);
}

export function addProductBarcode(id: string, barcode: string, storeId: string) {
  const product = mockProducts.find((item) => item.id === id);
  assertMockStoreResource(product, storeId, "Producto no encontrado.");

  const normalized = normalizeBarcode(barcode);
  if (!normalized) {
    throw new ApiError(400, "BAD_REQUEST", "El codigo de barras es obligatorio.");
  }

  if (normalizeBarcode(product.barcode)) {
    throw new ApiError(
      400,
      "BAD_REQUEST",
      "El producto ya tiene codigo de barras; no se puede modificar desde esta accion.",
    );
  }

  if (
    mockProducts.some(
      (item) =>
        item.id !== id &&
        item.storeId === storeId &&
        normalizeBarcode(item.barcode) === normalized,
    )
  ) {
    throw new ApiError(409, "CONFLICT", "Ya existe un producto con este codigo de barras.");
  }

  product.barcode = normalized;
  return getProductById(id, storeId);
}

/** Como la RPC `update_product_price`: el precio nuevo queda guardado en el producto. */
export function updateProductPrice(id: string, input: ProductPriceInput, storeId: string) {
  const product = mockProducts.find((item) => item.id === id);
  assertMockStoreResource(product, storeId, "Producto no encontrado.");

  product.salePriceRef = input.salePriceRef;

  return getProductById(id, storeId);
}

export function deleteProduct(id: string, storeId: string) {
  const product = mockProducts.find((item) => item.id === id);
  assertMockStoreResource(product, storeId, "Producto no encontrado.");

  if (product.isActive === false) {
    throw new ApiError(404, "NOT_FOUND", "Producto no encontrado.");
  }

  product.isActive = false;

  return {
    ...getProductById(id, storeId),
    deleted: true,
  };
}

export function getProductPriceHistory(id: string, searchParams: URLSearchParams, storeId: string) {
  getProductById(id, storeId);

  // Como `products.server`: el cambio más reciente primero. Entre dos con la
  // misma fecha gana el último registrado.
  const history = mockProductPriceHistory
    .filter((item) => item.productId === id)
    .reverse()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map(toMockPriceHistoryEntry);

  return paginateList(history, searchParams);
}

export function getProductSales(id: string, searchParams: URLSearchParams, storeId: string) {
  getProductById(id, storeId);

  const salesById = new Map(mockSales.map((sale) => [sale.id, sale]));
  const rows = joinProductSaleItems(
    mockSaleItems
      .filter((item) => item.productId === id)
      .map((item) => ({
        id: `${item.saleId}:${item.productId}`,
        quantity: item.quantity,
        saleId: item.saleId,
        subtotalRef: item.subtotalRef,
        subtotalVes: item.subtotalVes,
        unitPriceRef: item.unitPriceRef,
      })),
    salesById,
    storeId,
  );

  return buildProductSaleHistoryResult(rows, searchParams);
}

export function createProductPriceHistoryEntry(id: string, input: ProductPriceInput, storeId: string) {
  const product = mockProducts.find((item) => item.id === id);
  assertMockStoreResource(product, storeId, "Producto no encontrado.");
  // Como `update_product_price_checked`: antes de registrar nada, 409 si el costo ya no es el que vio el usuario.
  assertMockExpectedCost(id, input.expectedCostRef, storeId);

  // Como la RPC `update_product_price`, que inserta en `product_price_history`
  // el precio anterior, el nuevo y la instantánea de costo y banda: el historial
  // que se lee después incluye este cambio. La ruta la llama ANTES de
  // `updateProductPrice`, por eso el precio anterior aún está en el producto.
  return recordMockPriceChange(product, {
    reason: input.reason ?? null,
    salePriceRef: input.salePriceRef,
  });
}

export function listPackConversions(storeId: string) {
  return mockProductPackConversions
    .filter((item) => item.isActive && item.storeId === storeId)
    .flatMap((link) => {
      const recipe = toMockRecipeView(link);
      const item = recipe ? buildPackConversionListItem(recipe) : null;

      return item ? [item] : [];
    });
}
