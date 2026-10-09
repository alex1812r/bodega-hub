import type { ScannerBurst, ScannerInputHandler } from "@/shared/components/ConfirmActionModal";

import { readPurchaseLineScan } from "../utils/purchaseLineScan";

/**
 * Lector de códigos con la confirmación de compra abierta (CNF-F5). El Enter de la
 * lectura ya no llega a ningún botón: lo detecta y lo ignora `ConfirmActionModal`
 * (`useScannerBurstGuard`, CNF-F7), con cualquier foco y también con lectores lentos o
 * códigos con letras. Esto solo traduce lo leído para la compra.
 *
 * Devuelve el `onScannerInput` del modal. `onScan` recibe los códigos posibles (los
 * mismos candidatos que una celda de línea, sobre los dígitos seguidos con que termina la
 * lectura) o `null` si no medía como un código.
 */
export function usePurchaseConfirmScanGuard(
  onScan: ((candidates: string[] | null) => void) | undefined,
): ScannerInputHandler | undefined {
  if (!onScan) {
    return undefined;
  }

  return (text: string, { enteredAt, keyTimes }: ScannerBurst) => {
    const digits = /\d*$/.exec(text)?.[0] ?? "";
    const reading = readPurchaseLineScan(
      digits,
      keyTimes.slice(keyTimes.length - digits.length),
      enteredAt,
    );

    onScan(reading ? reading.candidates : null);
  };
}
