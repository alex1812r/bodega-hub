import type { StockMovementType } from "@/shared/mocks/erp-data";

export type InventoryAdjustmentType = Extract<
  StockMovementType,
  | "ajuste_entrada"
  | "ajuste_salida"
  | "devolucion_cliente"
  | "devolucion_proveedor"
  | "inventario_inicial"
>;

export const movementTypeOptions: Array<{ label: string; value: StockMovementType }> = [
  { label: "Ajuste entrada", value: "ajuste_entrada" },
  { label: "Ajuste salida", value: "ajuste_salida" },
  { label: "Venta", value: "venta" },
  { label: "Compra", value: "compra" },
  { label: "Devolución cliente", value: "devolucion_cliente" },
  { label: "Devolución proveedor", value: "devolucion_proveedor" },
  { label: "Inventario inicial", value: "inventario_inicial" },
];

export const inventoryAdjustmentTypeOptions = movementTypeOptions.filter(
  (option): option is { label: string; value: InventoryAdjustmentType } =>
    (
      [
        "ajuste_entrada",
        "ajuste_salida",
        "devolucion_cliente",
        "devolucion_proveedor",
        "inventario_inicial",
      ] as StockMovementType[]
    ).includes(option.value),
);

const movementTypeLabelMap = Object.fromEntries(
  movementTypeOptions.map((option) => [option.value, option.label]),
) as Record<StockMovementType, string>;

export function getMovementTypeLabel(type: StockMovementType) {
  return movementTypeLabelMap[type];
}

export function getInventoryAdjustmentDelta(
  quantity: number,
  type: InventoryAdjustmentType,
) {
  const normalizedQuantity = Math.abs(quantity);

  if (type === "ajuste_salida" || type === "devolucion_proveedor") {
    return -normalizedQuantity;
  }

  return normalizedQuantity;
}

export const movementTypeBadgeVariant = {
  ajuste_entrada: "success",
  ajuste_salida: "warning",
  compra: "success",
  devolucion_cliente: "success",
  devolucion_proveedor: "warning",
  inventario_inicial: "success",
  venta: "info",
} as const;
