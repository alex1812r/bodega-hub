import type { InvoiceExtractionLine, InvoiceLineMatch } from "../../contracts";
import type { MatchAlias, MatchPackUnit, MatchProduct } from "../match.types";

import { isPositive } from "./text";

/** Unidades de la factura que significan "empaque". */
const PACK_UNITS = new Set<InvoiceExtractionLine["unit"]>(["caja", "bulto", "paquete", "display"]);

export type PackResolution = Pick<
  InvoiceLineMatch,
  "entryMode" | "packUnitId" | "unitsPerPack" | "disassembleOnReceive"
> & {
  /** Avisos de empaque; cualquiera degrada la línea a dudosa. */
  issues: string[];
};

export type PackInput = {
  line: InvoiceExtractionLine;
  /** Producto identificado por la cascada (sin él no hay empaques registrados que mirar). */
  product?: MatchProduct;
  /** Empaques activos del proveedor resuelto para ese producto. */
  packUnits: MatchPackUnit[];
  /** Alias exacto usado, si lo hubo. */
  alias?: MatchAlias;
};

function packWord(line: InvoiceExtractionLine): string {
  return line.unit && PACK_UNITS.has(line.unit) ? line.unit : "empaque";
}

function withRecipe(resolution: PackResolution, product?: MatchProduct): PackResolution {
  if (!product?.hasRecipe) {
    return resolution;
  }
  // Empaque con receta: siempre en modo empaque y desarmado al recibir. Sin
  // tamaño leído ni registrado, cada unidad del producto-empaque es 1 empaque.
  return {
    ...resolution,
    entryMode: "pack",
    unitsPerPack: resolution.entryMode === "pack" ? resolution.unitsPerPack : 1,
    disassembleOnReceive: true,
  };
}

function resolveWithSize(size: number, input: PackInput, fromAlias: boolean): PackResolution {
  const registered = input.packUnits.find((pack) => pack.unitsPerPack === size);
  if (registered) {
    return { entryMode: "pack", packUnitId: registered.id, unitsPerPack: size, issues: [] };
  }
  if (input.packUnits.length > 0) {
    // 6.8: tamaño leído distinto del registrado -> no se convierte sin confirmar.
    const sizes = input.packUnits.map((pack) => pack.unitsPerPack).join(" o ");
    return {
      entryMode: "pack",
      issues: [
        `La factura dice ${packWord(input.line)} de ${size} unidades y el empaque registrado es de ${sizes}: confirma las unidades por empaque.`,
      ],
    };
  }
  if (fromAlias) {
    // El alias ya confirmó ese tamaño con este proveedor.
    return { entryMode: "pack", unitsPerPack: size, issues: [] };
  }
  return {
    entryMode: "pack",
    unitsPerPack: size,
    issues: [
      `No hay empaque registrado de ${size} unidades para este proveedor: confirma las unidades por empaque.`,
    ],
  };
}

/**
 * Modo de entrada de una línea (plan §3 "Unidades y empaques"):
 * - Tamaño leído (línea o, si no, alias) = empaque registrado -> modo empaque
 *   con `packUnitId`.
 * - Tamaño leído distinto del registrado -> dudosa con aviso, SIN fijar
 *   `unitsPerPack` (6.8).
 * - Tamaño leído sin empaque registrado -> dudosa, `unitsPerPack` leído como
 *   sugerencia; el del alias no avisa (ya se confirmó).
 * - "caja/bulto" sin número: un solo empaque registrado -> ese; ninguno o
 *   varios -> dudosa pidiendo unidades por empaque. Nunca entra como 1 unidad (6.19).
 * - Producto con receta -> modo empaque + `disassembleOnReceive`.
 */
export function resolvePack(input: PackInput): PackResolution {
  const { line, alias } = input;
  const readSize = isPositive(line.unitsPerPack) ? line.unitsPerPack : undefined;
  const aliasSize = isPositive(alias?.unitsPerPack) ? alias?.unitsPerPack : undefined;
  const size = readSize ?? aliasSize;
  const isPack = (line.unit !== undefined && PACK_UNITS.has(line.unit)) || (size !== undefined && size > 1);

  if (!isPack) {
    return withRecipe({ entryMode: "unit", issues: [] }, input.product);
  }
  if (size !== undefined) {
    return withRecipe(resolveWithSize(size, input, readSize === undefined), input.product);
  }
  if (input.packUnits.length === 1) {
    const [only] = input.packUnits;
    return withRecipe(
      { entryMode: "pack", packUnitId: only.id, unitsPerPack: only.unitsPerPack, issues: [] },
      input.product,
    );
  }
  return withRecipe(
    {
      entryMode: "pack",
      issues: [`La factura no dice cuántas unidades trae cada ${packWord(line)}: indícalo.`],
    },
    input.product,
  );
}
