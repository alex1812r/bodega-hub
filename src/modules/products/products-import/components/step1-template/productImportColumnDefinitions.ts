export type ProductImportColumnDefinition = {
  alternateRow?: boolean;
  column: string;
  description: string;
  required: boolean;
};

export const PRODUCT_IMPORT_COLUMN_DEFINITIONS: ProductImportColumnDefinition[] =
  [
    {
      column: "sku",
      required: true,
      description:
        "Código único del producto. Si el SKU ya existe, se actualizarán sus datos.",
    },
    {
      column: "codigo_barras",
      required: false,
      description:
        "Código de barras EAN/UPC opcional. Debe ser único si se indica.",
    },
    {
      column: "nombre",
      required: true,
      description: "Nombre comercial del producto para el punto de venta.",
    },
    {
      column: "categoria",
      required: false,
      description:
        "Nombre exacto de la categoría. Se creará si no existe en el sistema.",
    },
    {
      column: "precio_ref",
      required: true,
      alternateRow: true,
      description:
        "Precio de venta en la moneda de referencia (USD). Usar punto como separador decimal (ej: 12.50).",
    },
    {
      column: "costo_ref",
      required: false,
      alternateRow: true,
      description: "Costo de adquisición en moneda de referencia (USD).",
    },
    {
      column: "stock_inicial",
      required: false,
      description:
        "Cantidad física actual. Solo aplica para productos nuevos (SKU no existente).",
    },
    {
      column: "stock_minimo",
      required: false,
      description: "Nivel de alerta para reabastecimiento en el dashboard.",
    },
  ];
