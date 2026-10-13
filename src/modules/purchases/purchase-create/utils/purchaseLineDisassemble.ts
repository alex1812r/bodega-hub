import type { PurchaseLineDisassembleState, PurchaseWebLine } from "../types";

const NO_PRODUCT_IDS: ReadonlySet<string> = new Set();

/** Lo que se lee de cada receta de `GET /api/inventory/pack-conversions`. */
type PurchasePackRecipe = {
  alwaysDisassembleOnReceive?: boolean;
  packProduct?: { id?: string };
} | null;

/**
 * «Desarmar al recibir» (COM-14) de cada línea de la compra en curso.
 *
 * `packProductIds` son los productos que son el EMPAQUE de una receta de apertura
 * activa (`GET /api/inventory/pack-conversions`, una sola consulta para toda la
 * compra). Solo sus líneas ofrecen el chip: `disassemble` queda en `true` /
 * `false`; las demás líneas se devuelven tal cual (sin la clave), también si
 * traían una marca guardada: una línea sin receta nunca se envía marcada.
 *
 * Lo que el usuario eligió en el chip (`marks`) manda. Una línea que no ha tocado
 * nace marcada si su producto está en `alwaysDisassembleProductIds`: los empaques
 * cuya receta activa tiene la preferencia «Desarmar siempre al recibir compras»
 * (misma consulta). Vale igual para una línea duplicada de otra compra: aplica
 * la preferencia de hoy.
 */
export function withPurchaseLineDisassemble(
  lines: readonly PurchaseWebLine[],
  marks: PurchaseLineDisassembleState | undefined,
  packProductIds: ReadonlySet<string>,
  alwaysDisassembleProductIds: ReadonlySet<string> = NO_PRODUCT_IDS,
): PurchaseWebLine[] {
  return lines.map((line) =>
    packProductIds.has(line.item.productId)
      ? {
          ...line,
          disassemble:
            marks?.[line.item.id] ?? alwaysDisassembleProductIds.has(line.item.productId),
        }
      : line,
  );
}

/**
 * De la respuesta de `GET /api/inventory/pack-conversions`: los empaques con
 * receta activa y, de ellos, los que tienen la preferencia «Desarmar siempre al
 * recibir compras». Una respuesta que no sea la lista esperada da dos conjuntos vacíos.
 */
export function readPurchasePackRecipes(recipes: unknown): {
  alwaysDisassembleProductIds: Set<string>;
  packProductIds: Set<string>;
} {
  const packProductIds = new Set<string>();
  const alwaysDisassembleProductIds = new Set<string>();

  for (const recipe of Array.isArray(recipes) ? (recipes as PurchasePackRecipe[]) : []) {
    const packProductId = recipe?.packProduct?.id;

    if (!packProductId) {
      continue;
    }

    packProductIds.add(packProductId);

    if (recipe.alwaysDisassembleOnReceive === true) {
      alwaysDisassembleProductIds.add(packProductId);
    }
  }

  return { alwaysDisassembleProductIds, packProductIds };
}

/** Lo que una línea añade al payload de la compra: la clave solo viaja cuando está marcada. */
export function purchaseLineDisassemblePayload(line: Pick<PurchaseWebLine, "disassemble">) {
  return line.disassemble === true ? { disassembleOnReceive: true as const } : {};
}
