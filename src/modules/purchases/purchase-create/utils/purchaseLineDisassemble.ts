import type { PurchaseLineDisassembleState, PurchaseWebLine } from "../types";

/**
 * «Desarmar al recibir» (COM-14) de cada línea de la compra en curso.
 *
 * `packProductIds` son los productos que son el EMPAQUE de una receta de apertura
 * activa (`GET /api/inventory/pack-conversions`, una sola consulta para toda la
 * compra). Solo sus líneas ofrecen el chip: `disassemble` queda en `true` /
 * `false` según la marca; las demás líneas se devuelven tal cual (sin la clave),
 * también si traían una marca guardada: una línea sin receta nunca se envía marcada.
 */
export function withPurchaseLineDisassemble(
  lines: readonly PurchaseWebLine[],
  marks: PurchaseLineDisassembleState | undefined,
  packProductIds: ReadonlySet<string>,
): PurchaseWebLine[] {
  return lines.map((line) =>
    packProductIds.has(line.item.productId)
      ? { ...line, disassemble: marks?.[line.item.id] === true }
      : line,
  );
}

/** Lo que una línea añade al payload de la compra: la clave solo viaja cuando está marcada. */
export function purchaseLineDisassemblePayload(line: Pick<PurchaseWebLine, "disassemble">) {
  return line.disassemble === true ? { disassembleOnReceive: true as const } : {};
}
