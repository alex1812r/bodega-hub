import { formatRefUsd } from "@/shared/utils/currency";

type PurchaseProcessLabelInput = {
  lineCount: number;
  supplierId: string;
  supplierName: string | null;
  totalRef: number;
};

/**
 * Nombre de la compra en curso para el guardia de salida (CNF-15, regla 14):
 * "Compra a Distribuidora X · 12 líneas · REF 240,00".
 */
export function describePurchaseInProgress({
  lineCount,
  supplierId,
  supplierName,
  totalRef,
}: PurchaseProcessLabelInput) {
  const supplier = supplierId
    ? `Compra a ${supplierName?.trim() || "proveedor elegido"}`
    : "Compra sin proveedor";

  return [supplier, lineCount === 1 ? "1 línea" : `${lineCount} líneas`, formatRefUsd(totalRef)].join(
    " · ",
  );
}
