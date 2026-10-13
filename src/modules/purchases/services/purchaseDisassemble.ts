import { z } from "zod";

/**
 * COM-14 · «Desarmar al recibir»: contrato compartido por el BFF, el mock y la
 * pantalla. Una línea marcada es la de un producto EMPAQUE con receta activa; al
 * recibir la compra sus empaques se abren en los componentes de la receta, en la
 * misma transacción que la recepción (parche `20261010d`).
 */

/** Un componente de la receta del empaque de la línea, con su stock actual. */
export type PurchaseLineRecipeComponent = {
  currentStock: number;
  isActive: boolean;
  name: string;
  unitProductId: string;
  /** Unidades de este producto por empaque. */
  unitsPerPack: number;
};

/** Receta ACTIVA del producto de la línea (el producto es su empaque). */
export type PurchaseLineRecipe = {
  components: PurchaseLineRecipeComponent[];
  conversionId: string;
  /** Unidades que salen del empaque en total. */
  totalUnits: number;
};

/** Lo que el detalle de compra añade a cada línea para el desarme. */
export type PurchaseItemDisassemble = {
  /** La recepción ya abrió los empaques de la línea. */
  disassembled?: boolean;
  /** Marca «Desarmar al recibir» guardada con la compra. */
  disassembleOnReceive?: boolean;
  /** Id de la línea: lo que se envía en `disassemble[].purchaseItemId`. */
  id?: string;
  /** Solo en un pedido y solo si el producto tiene receta activa. */
  packRecipe?: PurchaseLineRecipe;
};

/** Reparto real de una apertura (surtidos): unidades por componente. */
const distributionSchema = z
  .array(
    z.object({
      unitProductId: z.string().min(1),
      units: z.number().int().min(0),
    }),
  )
  .min(1)
  .max(20);

/**
 * Cuerpo opcional de `PATCH /api/purchases/{id}/receive`.
 * - Sin `disassemble`: se desarman las líneas marcadas, con su receta.
 * - Con `disassemble`: la lista ES el conjunto de líneas a desarmar (`[]` =
 *   ninguna); `distribution` es el reparto real de esa línea.
 */
export const receivePurchaseBodySchema = z.object({
  clientRequestId: z.string().uuid().optional(),
  disassemble: z
    .array(
      z.object({
        distribution: distributionSchema.optional(),
        purchaseItemId: z.string().min(1),
      }),
    )
    .max(500)
    .optional(),
});

export type ReceivePurchaseOptions = z.infer<typeof receivePurchaseBodySchema>;
export type ReceiveDisassembleEntry = NonNullable<ReceivePurchaseOptions["disassemble"]>[number];

/** La lista tal como la espera `receive_purchase_and_disassemble` (`p_disassemble`). */
export function toRpcDisassembleList(entries: readonly ReceiveDisassembleEntry[]) {
  return entries.map((entry) => ({
    purchase_item_id: entry.purchaseItemId,
    ...(entry.distribution
      ? {
          components: entry.distribution.map((item) => ({
            unit_product_id: item.unitProductId,
            units: item.units,
          })),
        }
      : {}),
  }));
}

/** Mensaje de `create_purchase` (PT400) para líneas marcadas sin receta activa. */
export function missingRecipeOnCreateMessage(productNames: readonly string[]) {
  return `Sin receta de apertura activa: ${productNames.join(", ")}. No se puede marcar «Desarmar al recibir» en esas líneas`;
}

/** Mensaje de `receive_purchase_and_disassemble` (PT409) para líneas marcadas sin receta activa. */
export function missingRecipeOnReceiveMessage(productNames: readonly string[]) {
  return `Sin receta de apertura activa: ${productNames.join(", ")}. Desmarca «Desarmar al recibir» en esas líneas o activa su receta`;
}
