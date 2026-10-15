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
  /** Alias exacto usado, si lo hubo (en líneas por SKU, el del mismo producto con el proveedor). */
  alias?: MatchAlias;
  /** `alias` es otro texto del mismo producto (línea por SKU): en modo unidad no gana a la palabra del texto. */
  aliasOfProduct?: boolean;
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

/** La factura declara la unidad de empaque (`unit` caja/bulto/paquete/display). */
function declaresPack(line: InvoiceExtractionLine): boolean {
  return line.unit !== undefined && PACK_UNITS.has(line.unit);
}

/**
 * Producto con receta: ES el empaque. Siempre en modo empaque, desarmado al
 * recibir y con la conversión registrada (`recipeUnitsPerPack`), la única que
 * acepta `create_purchase` (caos M-r3-1). Un tamaño leído o aprendido distinto
 * deja la línea dudosa con la conversión propuesta. Sin conversión conocida,
 * dudosa pidiendo unidades (nunca 1).
 */
function resolveRecipe(input: PackInput, readSize: number | undefined, aliasSize: number | undefined): PackResolution {
  const conversion = isPositive(input.product?.recipeUnitsPerPack) ? input.product.recipeUnitsPerPack : undefined;
  if (conversion === undefined) {
    return {
      entryMode: "pack",
      disassembleOnReceive: true,
      issues: ["No se conoce la conversión registrada de este empaque: confirma las unidades por empaque."],
    };
  }
  const issues: string[] = [];
  if (readSize !== undefined && readSize !== conversion) {
    issues.push(
      `La factura dice ${packWord(input.line)} de ${readSize} unidades y la receta del producto es de ${conversion}: confirma las unidades por empaque.`,
    );
  } else if (aliasSize !== undefined && aliasSize !== conversion) {
    issues.push(
      `El alias aprendido es de ${aliasSize} unidades por empaque y la receta del producto es de ${conversion}: confirma las unidades por empaque.`,
    );
  }
  if (input.line.unit === "unidad") {
    // "24 UND" de un producto-empaque: ¿24 empaques o 24 unidades sueltas? No se confirma (caos B-r4-1).
    issues.push(
      `La factura dice "unidad" y el producto es un empaque de ${conversion} unidades: confirma si son empaques o unidades sueltas.`,
    );
  }
  const registered = input.packUnits.find((pack) => pack.unitsPerPack === conversion);
  return {
    entryMode: "pack",
    ...(registered ? { packUnitId: registered.id } : {}),
    unitsPerPack: conversion,
    disassembleOnReceive: true,
    issues,
  };
}

/**
 * El proveedor ya lo facturó por unidad (alias en modo unidad) y ahora la
 * factura DECLARA un empaque: nunca confirma (caos A-r3-1, plan §10). Propone
 * el tamaño leído o el empaque único registrado, con aviso de contradicción.
 */
function resolveUnitAliasContradiction(input: PackInput, readSize: number | undefined): PackResolution {
  const { line, packUnits } = input;
  let base: PackResolution;
  if (readSize !== undefined) {
    base = resolveWithSize(readSize, input, false);
  } else if (packUnits.length === 1) {
    base = { entryMode: "pack", packUnitId: packUnits[0].id, unitsPerPack: packUnits[0].unitsPerPack, issues: [] };
  } else {
    base = { entryMode: "pack", issues: [`La factura no dice cuántas unidades trae cada ${packWord(line)}: indícalo.`] };
  }
  const proposed = packUnits.find((pack) => pack.id === base.packUnitId);
  const what = proposed ? `empaques "${proposed.label}" de ${proposed.unitsPerPack} unidades` : "empaques";
  return {
    ...base,
    issues: [
      `Antes este proveedor lo facturó por unidad; ahora dice ${packWord(line)}: confirma si son ${what} o unidades sueltas.`,
      ...base.issues,
    ],
  };
}

function resolveWithSize(size: number, input: PackInput, fromAlias: boolean): PackResolution {
  const registered = input.packUnits.find((pack) => pack.unitsPerPack === size);
  if (registered) {
    return { entryMode: "pack", packUnitId: registered.id, unitsPerPack: size, issues: [] };
  }
  if (input.packUnits.length > 0) {
    // 6.8: tamaño (leído o del alias) distinto del registrado -> no se convierte sin confirmar.
    const sizes = input.packUnits.map((pack) => pack.unitsPerPack).join(" o ");
    const source = fromAlias ? "El alias aprendido es de" : "La factura dice";
    return {
      entryMode: "pack",
      issues: [
        `${source} ${packWord(input.line)} de ${size} unidades y el empaque registrado es de ${sizes}: confirma las unidades por empaque.`,
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
 * - Producto con receta -> modo empaque + `disassembleOnReceive` con la
 *   conversión registrada; otro tamaño leído o aprendido -> dudosa (caos M-r3-1).
 * - Alias del proveedor aprendido en modo unidad (`unitsPerPack` null) y la
 *   factura DECLARA caja/bulto/paquete/display -> dudosa con aviso de
 *   contradicción y el empaque solo propuesto, nunca confirmado (caos A-r3-1).
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
 * - Empaque sin número: si la factura lo declara (`unit` caja/bulto/paquete/
 *   display), sin alias en modo unidad, y hay un solo empaque registrado ->
 *   ese. Si el indicio es solo una palabra del texto o `unit: "otro"`, nunca
 *   confirma por sí solo: un alias del proveedor aprendido en modo unidad manda
 *   (modo unidad); si no, el empaque único queda propuesto con aviso (caos
 *   A-n1). Ninguno o varios -> dudosa pidiendo unidades por empaque. Nunca
 *   entra como 1 unidad (6.19, caos M5).
 * - Componente de receta (`componentPackSizes`): ver `resolvePack`.
 */
function resolvePackMode(input: PackInput): PackResolution {
  const { line, alias } = input;
  const readSize = isPositive(line.unitsPerPack) ? line.unitsPerPack : undefined;
  const aliasSize = isPositive(alias?.unitsPerPack) ? alias?.unitsPerPack : undefined;

  if (input.product?.hasRecipe) {
    return resolveRecipe(input, readSize, aliasSize);
  }
  const declared = declaresPack(line);
  if (declared && alias && aliasSize === undefined) {
    return resolveUnitAliasContradiction(input, readSize);
  }
  const indicated = indicatesPack(line, input.product);

  if (readSize !== undefined) {
    if (aliasSize !== undefined && aliasSize !== readSize) {
      return {
        entryMode: "pack",
        issues: [
          `La factura dice ${packWord(line)} de ${readSize} unidades y el alias aprendido es de ${aliasSize}: confirma las unidades por empaque.`,
        ],
      };
    }
    if (indicated || readSize > 1) {
      return resolveWithSize(readSize, input, false);
    }
  } else if (aliasSize !== undefined && line.unit !== "unidad") {
    if (indicated) {
      return resolveWithSize(aliasSize, input, true);
    }
    if (aliasSize > 1) {
      return {
        entryMode: "unit",
        issues: [
          `La línea no dice que sea un empaque y el alias aprendido es de ${aliasSize} unidades por empaque: confirma si son unidades o empaques.`,
        ],
      };
    }
  }

  if (!indicated) {
    return { entryMode: "unit", issues: [] };
  }
  if (alias && aliasSize === undefined && !input.aliasOfProduct) {
    // Alias aprendido en modo unidad: gana a la palabra del texto o a "otro" (caos A-n1).
    return { entryMode: "unit", issues: [] };
  }
  if (input.packUnits.length === 1) {
    const [only] = input.packUnits;
    return {
      entryMode: "pack",
      packUnitId: only.id,
      unitsPerPack: only.unitsPerPack,
      issues: declared
        ? []
        : [
            `La factura no declara la unidad de empaque (solo se intuye del texto): confirma si son empaques "${only.label}" de ${only.unitsPerPack} unidades o unidades sueltas.`,
          ],
    };
  }
  return {
    entryMode: "pack",
    issues: [`La factura no dice cuántas unidades trae cada ${packWord(line)}: indícalo.`],
  };
}

/**
 * Modo de entrada de la línea (`resolvePackMode`) más la guarda de componente
 * de receta (caos M-r4-1): si el producto es la unidad de una receta activa de
 * otro producto, `create_purchase` solo acepta en modo empaque los tamaños de
 * esas recetas (`componentPackSizes`, 20261010d `v_unit_pack_sizes`). Un tamaño
 * fuera de ellos deja la línea dudosa con aviso que nombra los permitidos y sin
 * fijar el empaque (el del proveedor no se puede guardar; se decide a mano).
 */
export function resolvePack(input: PackInput): PackResolution {
  const resolution = resolvePackMode(input);
  const allowed = (input.product?.componentPackSizes ?? []).filter((size) => isPositive(size));
  const size = resolution.unitsPerPack;
  if (resolution.entryMode !== "pack" || allowed.length === 0 || size === undefined || allowed.includes(size)) {
    return resolution;
  }
  const sizes = allowed.join(" o ");
  return {
    entryMode: "pack",
    ...(resolution.disassembleOnReceive ? { disassembleOnReceive: true } : {}),
    issues: [
      ...resolution.issues,
      `El empaque es de ${size} unidades, pero este producto es componente de una receta de ${sizes} unidades por empaque: confirma las unidades por empaque (la compra solo acepta ${sizes}).`,
    ],
  };
}
