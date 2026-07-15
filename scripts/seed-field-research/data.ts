export type FieldResearchProduct = {
  categoryName: "Bebidas" | "Chucherias";
  name: string;
  packLabel: string;
  packPriceRef: number;
  packUnits: number;
  sku: string;
  supplierKey: "bodega_bebida" | "congolos";
  unitCostRef: number;
};

export const FIELD_RESEARCH_SUPPLIERS = {
  bodega_bebida: {
    address: "Av. principal El Cementerio, Los Carmenes",
    name: "Bodega de bebida",
    notes: "Ref entre frente de Ferrera Ferrera. Cotización investigación jul/2026.",
    type: "proveedor" as const,
  },
  congolos: {
    address: "El Cementerio, entrada del centro comercial San Jorge",
    name: "Tienda Congolos",
    notes: "Cotización investigación jul/2026.",
    type: "proveedor" as const,
  },
};

export const FIELD_RESEARCH_CATEGORIES = [
  { description: "Refrescos y bebidas gaseosas", name: "Bebidas" },
  { description: "Snacks, papitas y golosinas", name: "Chucherias" },
] as const;

/** Precios de campo = costo por caja/paquete; unitCostRef = packPriceRef / packUnits. */
export const FIELD_RESEARCH_PRODUCTS: FieldResearchProduct[] = [
  {
    categoryName: "Bebidas",
    name: "Glup 2L",
    packLabel: "Caja 6 und",
    packPriceRef: 5.5,
    packUnits: 6,
    sku: "glup-2lt",
    supplierKey: "bodega_bebida",
    unitCostRef: 0.92,
  },
  {
    categoryName: "Bebidas",
    name: "Frescolita 1.5L",
    packLabel: "Caja 6 und",
    packPriceRef: 4.8,
    packUnits: 6,
    sku: "frescolita-1-5lt",
    supplierKey: "bodega_bebida",
    unitCostRef: 0.8,
  },
  {
    categoryName: "Bebidas",
    name: "Fanta 2L",
    packLabel: "Caja 6 und",
    packPriceRef: 5,
    packUnits: 6,
    sku: "fanta-2lt",
    supplierKey: "bodega_bebida",
    unitCostRef: 0.83,
  },
  {
    categoryName: "Bebidas",
    name: "Coca-Cola 2L",
    packLabel: "Caja 6 und",
    packPriceRef: 8,
    packUnits: 6,
    sku: "coca-cola-2lt",
    supplierKey: "bodega_bebida",
    unitCostRef: 1.33,
  },
  {
    categoryName: "Bebidas",
    name: "Coca-Cola 1L",
    packLabel: "Caja 6 und",
    packPriceRef: 5,
    packUnits: 6,
    sku: "coca-cola-1lt",
    supplierKey: "bodega_bebida",
    unitCostRef: 0.83,
  },
  {
    categoryName: "Bebidas",
    name: "Coca-Cola 1.5L",
    packLabel: "Caja 6 und",
    packPriceRef: 6.5,
    packUnits: 6,
    sku: "coca-cola-1-5lt",
    supplierKey: "bodega_bebida",
    unitCostRef: 1.08,
  },
  {
    categoryName: "Chucherias",
    name: "Cheestris 50gr",
    packLabel: "Paquete 12 und",
    packPriceRef: 9.5,
    packUnits: 12,
    sku: "cheestris-50gr",
    supplierKey: "congolos",
    unitCostRef: 0.79,
  },
  {
    categoryName: "Chucherias",
    name: "Doritos 45gr",
    packLabel: "Paquete 12 und",
    packPriceRef: 10.9,
    packUnits: 12,
    sku: "doritos-45gr",
    supplierKey: "congolos",
    unitCostRef: 0.91,
  },
  {
    categoryName: "Chucherias",
    name: "Flips 28gr",
    packLabel: "Paquete 12 und",
    packPriceRef: 7.6,
    packUnits: 12,
    sku: "flips-28gr",
    supplierKey: "congolos",
    unitCostRef: 0.63,
  },
  {
    categoryName: "Chucherias",
    name: "Kesitos 25gr",
    packLabel: "Paquete 12 und",
    packPriceRef: 7,
    packUnits: 12,
    sku: "kesitos-25gr",
    supplierKey: "congolos",
    unitCostRef: 0.58,
  },
  {
    categoryName: "Chucherias",
    name: "Chiskesitos 45gr",
    packLabel: "Paquete 12 und",
    packPriceRef: 8.5,
    packUnits: 12,
    sku: "chiskesitos-45gr",
    supplierKey: "congolos",
    unitCostRef: 0.71,
  },
  {
    categoryName: "Chucherias",
    name: "Puffy 25gr",
    packLabel: "Paquete 12 und",
    packPriceRef: 3.5,
    packUnits: 12,
    sku: "puffy-25gr",
    supplierKey: "congolos",
    unitCostRef: 0.29,
  },
];
