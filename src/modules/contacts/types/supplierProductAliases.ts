/**
 * SCN-09b · Alias aprendido de facturas (`supplier_product_aliases`) tal como lo
 * devuelve `GET /api/contacts/[id]/product-aliases`.
 */
export type SupplierProductAlias = {
  /** Texto de la factura normalizado (`normalizeAlias`). */
  aliasNorm: string;
  /** Veces que se confirmó este alias con el mismo producto. */
  hits: number;
  id: string;
  /** El producto está en la lista de productos del proveedor (`supplier_products`). */
  inSupplierProducts: boolean;
  /** `last_seen_at` (ISO). */
  lastSeenAt: string;
  packLabel: string | null;
  productId: string;
  productName: string | null;
  unitsPerPack: number | null;
};

export type SupplierProductAliasList = {
  items: SupplierProductAlias[];
};

export type RemovedSupplierProductAlias = {
  id: string;
};
