import { isIntegerText, parseNumberInput } from "@/shared/components/NumberInput";

import { computePackOpeningEffect } from "./packOpeningEffect";

/**
 * Reparto real de la apertura de un empaque surtido: cuántas unidades recibe
 * cada componente de la receta. Sin React: lo usan el control
 * `PackDistributionFields` y quien construye el efecto o la petición a partir de
 * lo que el usuario tecleó (p. ej. la previsualización de la recepción de una
 * compra). La regla es la de `convert_pack_to_units` (PRO-12): unidades enteras
 * ≥ 0 que suman `unidades por empaque × empaques`.
 *
 * La aritmética (totales, diferencia, unidades no válidas) es la de
 * `computePackOpeningEffect` (INV-08): un solo cálculo para la apertura de
 * empaque y para «Desarmar al recibir» (INT-02).
 */

/** Lo que el reparto necesita de un componente de la receta. */
export type PackDistributionComponent = {
  unitProductId: string;
  /** Unidades de este producto por empaque, según la receta. */
  unitsPerPack: number;
};

/** Unidades por id de producto componente. */
export type PackDistributionUnits = Record<string, number>;

/**
 * Texto de cada campo, por id de producto componente. Un componente sin entrada
 * no se ha tocado: vale lo que dice la receta.
 */
export type PackDistributionValue = Record<string, string>;

export type PackDistributionCheck = {
  /** Repartido − esperado: negativo = faltan unidades, positivo = sobran. */
  difference: number;
  distributedTotal: number;
  /** Unidades por empaque de la receta × empaques. */
  expectedTotal: number;
  /** Alguna cantidad es negativa, tiene decimales o no es un número. */
  hasInvalidUnits: boolean;
  /** `true` si el reparto no es el de la receta (y por tanto hay que enviarlo). */
  isAdjusted: boolean;
  isValid: boolean;
  /** Por qué no vale, en una frase; `null` si vale. */
  message: string | null;
  /** Una entrada por componente de la receta, en su orden. */
  units: PackDistributionUnits;
};

/** Reparto por receta: `unidades por empaque × empaques` de cada componente. */
export function buildDefaultPackDistribution(
  components: readonly PackDistributionComponent[],
  packQuantity: number,
): PackDistributionUnits {
  return Object.fromEntries(
    components.map((component) => [component.unitProductId, component.unitsPerPack * packQuantity]),
  );
}

/**
 * Lo tecleado, como unidades: un campo vacío reparte 0; un componente sin
 * entrada conserva lo de la receta; un texto que no es un entero queda como
 * `NaN` (lo rechaza `checkPackDistribution`).
 */
export function parsePackDistribution(
  components: readonly PackDistributionComponent[],
  packQuantity: number,
  value: PackDistributionValue,
): PackDistributionUnits {
  const defaults = buildDefaultPackDistribution(components, packQuantity);

  return Object.fromEntries(
    components.map((component) => {
      const text = value[component.unitProductId];

      if (text === undefined) {
        return [component.unitProductId, defaults[component.unitProductId] ?? 0];
      }

      if (text.trim() === "") {
        return [component.unitProductId, 0];
      }

      return [
        component.unitProductId,
        isIntegerText(text) ? (parseNumberInput(text) ?? Number.NaN) : Number.NaN,
      ];
    }),
  );
}

function describeIssue(hasInvalidUnits: boolean, difference: number, expectedTotal: number) {
  if (hasInvalidUnits) {
    return "Las unidades del reparto deben ser enteros mayores o iguales a cero.";
  }

  if (difference < 0) {
    return `Faltan ${-difference} unidad(es) por repartir: el reparto debe sumar ${expectedTotal}.`;
  }

  if (difference > 0) {
    return `Sobran ${difference} unidad(es): el reparto debe sumar ${expectedTotal}.`;
  }

  return null;
}

/**
 * Comprueba un reparto contra la receta. Los productos que no son de la receta
 * se ignoran y un componente que falta cuenta lo de la receta.
 */
export function checkPackDistribution(
  components: readonly PackDistributionComponent[],
  packQuantity: number,
  distribution: PackDistributionUnits | undefined,
): PackDistributionCheck {
  const defaults = buildDefaultPackDistribution(components, packQuantity);
  const units = Object.fromEntries(
    components.map((component) => [
      component.unitProductId,
      distribution?.[component.unitProductId] ?? defaults[component.unitProductId] ?? 0,
    ]),
  );
  const effect = computePackOpeningEffect({
    distribution: units,
    packQuantity,
    recipe: {
      components: components.map((component) => ({
        currentStock: 0,
        isActive: true,
        name: "",
        sku: "",
        unitProductId: component.unitProductId,
        unitsPerPack: component.unitsPerPack,
      })),
      // El reparto no depende del stock del empaque: aquí nunca queda en negativo.
      pack: { currentStock: packQuantity, name: "" },
    },
  });
  const { difference, distributedTotal, expectedTotal } = effect;
  const hasInvalidUnits = effect.issues.includes("invalid_units");
  const message = describeIssue(hasInvalidUnits, difference, expectedTotal);

  return {
    difference,
    distributedTotal,
    expectedTotal,
    hasInvalidUnits,
    isAdjusted: components.some(
      (component) => units[component.unitProductId] !== defaults[component.unitProductId],
    ),
    isValid: message === null,
    message,
    units,
  };
}

/** El reparto como lo esperan el BFF y la RPC: una entrada por componente, en el orden de la receta. */
export function toPackDistributionList(
  components: readonly PackDistributionComponent[],
  units: PackDistributionUnits,
) {
  return components.map((component) => ({
    unitProductId: component.unitProductId,
    units: units[component.unitProductId] ?? 0,
  }));
}
