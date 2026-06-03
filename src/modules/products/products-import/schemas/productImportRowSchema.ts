import { z } from "zod";

export const PRODUCT_IMPORT_MAX_ROWS = 500;

export const PRODUCT_IMPORT_SHEET = "Productos";
export const PRODUCT_IMPORT_CATEGORIES_SHEET = "Categorias";
export const PRODUCT_IMPORT_INSTRUCTIONS_SHEET = "Instrucciones";

export const PRODUCT_IMPORT_HEADERS = [
  "sku",
  "nombre",
  "categoria",
  "precio_ref",
  "costo_ref",
  "stock_inicial",
  "stock_minimo",
] as const;

export type ProductImportHeader = (typeof PRODUCT_IMPORT_HEADERS)[number];

export const productImportRowSchema = z.object({
  categoria: z.string().trim().optional(),
  costo_ref: z.number().min(0).optional(),
  nombre: z.string().trim().min(1, "El nombre es obligatorio."),
  precio_ref: z.number().min(0, "El precio ref debe ser mayor o igual a 0."),
  sku: z.string().trim().min(1, "El SKU es obligatorio."),
  stock_inicial: z.number().int().min(0).optional(),
  stock_minimo: z.number().int().min(0).optional(),
});

export type ProductImportRowParsed = z.infer<typeof productImportRowSchema>;

export const PRODUCT_IMPORT_EXAMPLE_ROW: ProductImportRowParsed = {
  sku: "BOD-EJ-001",
  nombre: "Producto ejemplo",
  categoria: "Chucherias",
  precio_ref: 1.5,
  costo_ref: 0.8,
  stock_inicial: 0,
  stock_minimo: 5,
};
