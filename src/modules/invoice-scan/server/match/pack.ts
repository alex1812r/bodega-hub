import type { InvoiceExtractionLine, InvoiceLineMatch } from "../../contracts";
import type { MatchAlias, MatchPackUnit, MatchProduct } from "../match.types";

import { isPositive } from "./text";

/** Unidades de la factura que significan "empaque". */
const PACK_UNITS = new Set<InvoiceExtractionLine["unit"]>(["caja", "bulto", "paquete", "display"]);
/**
 * Palabras de empaque en el texto de la línea cuando el modelo no dio `unit`
 * (6.19, caos M5). Con límites de letra: "CAJA" sí, "CAJAMARCA" no.
 */
const PACK_WORD =
  /(?<![A-Z])(?:CAJAS?|CJS?|CJA|BULTOS?|BTOS?|FARDOS?|PAQ|PAQS|PAQUETES?|PQT|DISPLAYS?|DOC|DOCENAS?|BLISTERS?|RISTRAS?|EMPAQUES?)(?![A-Z])/i;

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

/**
 * La línea indica empaque: `unit` de empaque u "otro" (FARDO, DOC, RISTRA…),
 * o, si el modelo no dio `unit`, una palabra de empaque en el texto. Un
 * producto con receta ya es el empaque: su nombre ("CAJA MALTA X36") no cuenta.
 */
function indicatesPack(line: InvoiceExtractionLine, product?: MatchProduct): boolean {
  if (line.unit !== undefined) {
    return line.unit === "otro" || PACK_UNITS.has(line.unit);
  }
  return !product?.hasRecipe && (PACK_WORD.test(line.rawText) || PACK_WORD.test(line.description));
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
 * - Tamaño leído = empaque registrado -> modo empaque con `packUnitId`.
 * - Tamaño leído distinto del registrado o del alias -> dudosa con aviso, SIN
 *   fijar `unitsPerPack` (6.8, caos A1).
 * - Tamaño leído sin empaque registrado -> dudosa, `unitsPerPack` leído como
 *   sugerencia.
 * - El tamaño del alias solo se aplica si la línea indica empaque (`unit` de
 *   empaque/"otro" o palabra de empaque en el texto); ya confirmado, no avisa.
 *   Si la línea dice "unidad" gana la línea (modo unidad; la coherencia de
 *   precio avisa si el importe es de empaque). Sin ningún indicio -> dudosa en
 *   modo unidad: nunca se multiplica sin indicio (caos A1).
 * - Empaque sin número ("caja", "otro", "BULTO" en el texto): un solo empaque
 *   registrado -> ese; ninguno o varios -> dudosa pidiendo unidades por
 *   empaque. Nunca entra como 1 unidad (6.19, caos M5).
 * - Producto con receta -> modo empaque + `disassembleOnReceive`.
 */
export function resolvePack(input: PackInput): PackResolution {
  const { line, alias } = input;
  const readSize = isPositive(line.unitsPerPack) ? line.unitsPerPack : undefined;
  const aliasSize = isPositive(alias?.unitsPerPack) ? alias?.unitsPerPack : undefined;
  const indicated = indicatesPack(line, input.product);

  if (readSize !== undefined) {
    if (aliasSize !== undefined && aliasSize !== readSize) {
      return withRecipe(
        {
          entryMode: "pack",
          issues: [
            `La factura dice ${packWord(line)} de ${readSize} unidades y el alias aprendido es de ${aliasSize}: confirma las unidades por empaque.`,
          ],
        },
        input.product,
      );
    }
    if (indicated || readSize > 1) {
      return withRecipe(resolveWithSize(readSize, input, false), input.product);
    }
  } else if (aliasSize !== undefined && line.unit !== "unidad") {
    if (indicated) {
      return withRecipe(resolveWithSize(aliasSize, input, true), input.product);
    }
    if (aliasSize > 1) {
      return withRecipe(
        {
          entryMode: "unit",
          issues: [
            `La línea no dice que sea un empaque y el alias aprendido es de ${aliasSize} unidades por empaque: confirma si son unidades o empaques.`,
          ],
        },
        input.product,
      );
    }
  }

  if (!indicated) {
    return withRecipe({ entryMode: "unit", issues: [] }, input.product);
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
