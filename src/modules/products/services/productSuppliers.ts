import { z } from "zod";

import { ApiError } from "@/lib/api/apiError";
import { normalizeOptionalSku } from "@/shared/utils/skuGeneration";

/** Proveedores por producto en una llamada (el mismo tope de la RPC `save_product_suppliers`). */
export const PRODUCT_SUPPLIERS_MAX = 50;

/** Tope de `supplier_products.last_cost_ref` (`numeric(12,2)`). */
export const PRODUCT_SUPPLIER_MAX_COST_REF = 9_999_999_999.99;

export const PRODUCT_SUPPLIERS_MESSAGES = {
  manyPreferred: "Solo un proveedor puede ser el habitual del producto.",
  supplierNotFound: "Proveedor no encontrado.",
  inactiveLink: (name: string) => `El proveedor ${name} está inactivo: no se puede vincular al producto.`,
  inactivePreferred: (name: string) =>
    `El proveedor ${name} está inactivo: no puede ser el habitual del producto.`,
} as const;

const productSupplierInputSchema = z.object({
  /** Costo REF por unidad. Sin él (o `null`) el costo del vínculo no se toca. */
  costRef: z
    .number({ message: "El costo del proveedor debe ser un número." })
    .min(0, "El costo del proveedor no puede ser negativo.")
    .max(PRODUCT_SUPPLIER_MAX_COST_REF, "El costo del proveedor está fuera de rango.")
    .nullable()
    .optional(),
  isPreferred: z.boolean({ message: "La marca de proveedor habitual no es válida." }).optional(),
  supplierId: z
    .string({ message: "El proveedor es obligatorio." })
    .trim()
    .min(1, "El proveedor es obligatorio."),
  /** Sin la clave el código no se toca; `null` o vacío lo borra. */
  supplierSku: z
    .string({ message: "El código del proveedor no es válido." })
    .max(120, "El código del proveedor admite hasta 120 caracteres.")
    .nullable()
    .optional(),
});

/**
 * Cuerpo de `PUT /api/products/[id]/suppliers`: el estado DESEADO completo de
 * los vínculos activos del producto.
 */
export const saveProductSuppliersSchema = z.object({
  suppliers: z
    .array(productSupplierInputSchema, { message: "La lista de proveedores no es válida." })
    .max(PRODUCT_SUPPLIERS_MAX, `Un producto admite como máximo ${PRODUCT_SUPPLIERS_MAX} proveedores.`),
});

export type ProductSupplierInput = {
  costRef?: number;
  isPreferred: boolean;
  supplierId: string;
  /** `undefined` = no tocar; `null` = borrar. */
  supplierSku?: string | null;
};

type RawProductSupplierInput = z.infer<typeof productSupplierInputSchema>;

function normalizeProductSupplierInput(raw: RawProductSupplierInput): ProductSupplierInput {
  return {
    ...(raw.costRef === null || raw.costRef === undefined
      ? {}
      : { costRef: Math.round(raw.costRef * 100) / 100 }),
    isPreferred: raw.isPreferred ?? false,
    supplierId: raw.supplierId,
    ...(raw.supplierSku === undefined
      ? {}
      : { supplierSku: normalizeOptionalSku(raw.supplierSku ?? undefined) ?? null }),
  };
}

/**
 * Funde el mismo proveedor repetido en una sola fila, igual que la RPC: conserva
 * la posición de la primera aparición, gana la ÚLTIMA aparición (costo y código,
 * también cuando no los trae) y es habitual si alguna lo marca.
 */
export function mergeProductSupplierInputs(inputs: ProductSupplierInput[]): ProductSupplierInput[] {
  const merged = new Map<string, ProductSupplierInput>();

  for (const input of inputs) {
    const previous = merged.get(input.supplierId);

    merged.set(input.supplierId, {
      ...input,
      isPreferred: input.isPreferred || (previous?.isPreferred ?? false),
    });
  }

  return [...merged.values()];
}

/**
 * Valida el cuerpo del `PUT` y devuelve la lista ya fundida. Formato inválido →
 * `ZodError` (400 con `issues`); más de un habitual → 400 con mensaje.
 */
export function parseSaveProductSuppliersInput(body: unknown): ProductSupplierInput[] {
  const { suppliers } = saveProductSuppliersSchema.parse(body);
  const merged = mergeProductSupplierInputs(suppliers.map(normalizeProductSupplierInput));

  if (merged.filter((supplier) => supplier.isPreferred).length > 1) {
    throw new ApiError(400, "BAD_REQUEST", PRODUCT_SUPPLIERS_MESSAGES.manyPreferred);
  }

  return merged;
}

/** Vínculo activo proveedor–producto tal como lo devuelve el `PUT`. */
export type ProductSupplierLink = {
  /** Último costo REF por unidad registrado (0 = sin costo registrado). */
  costRef: number;
  /** Id del vínculo (`supplier_products.id`). */
  id: string;
  isPreferred: boolean;
  lastPurchasedAt?: string;
  supplierId: string;
  supplierIsActive: boolean;
  supplierName: string;
  supplierSku?: string;
  updatedAt?: string;
};

export type SaveProductSuppliersResult = {
  /** El servidor movió o quitó el habitual sin que la lista marcara uno. */
  preferredAutoAssigned: boolean;
  /** El habitual final es distinto del que había antes de guardar. */
  preferredChanged: boolean;
  preferredSupplierId: string | null;
  previousPreferredSupplierId: string | null;
  /** Vínculos activos tras guardar: el habitual primero, después por nombre. */
  suppliers: ProductSupplierLink[];
};

/** Proveedor habitual de un producto (`preferredSupplier` en listado y detalle). */
export type ProductPreferredSupplier = { id: string; name: string };

/** Orden de la respuesta: el habitual primero, después por nombre y por id. */
export function sortProductSupplierLinks(links: ProductSupplierLink[]): ProductSupplierLink[] {
  return [...links].sort(
    (first, second) =>
      Number(second.isPreferred) - Number(first.isPreferred) ||
      first.supplierName.localeCompare(second.supplierName) ||
      first.id.localeCompare(second.id),
  );
}

/** Añade `preferredSupplier` a los productos que tienen proveedor habitual. */
export function attachPreferredSuppliers<TProduct extends { id: string }>(
  products: TProduct[],
  preferredByProduct: Map<string, ProductPreferredSupplier>,
): (TProduct & { preferredSupplier?: ProductPreferredSupplier })[] {
  return products.map((product) => {
    const preferredSupplier = preferredByProduct.get(product.id);

    return preferredSupplier ? { ...product, preferredSupplier } : product;
  });
}
